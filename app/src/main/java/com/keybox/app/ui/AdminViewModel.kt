package com.keybox.app.ui

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.keybox.app.data.AdminUserRow
import com.keybox.app.data.ServiceLocator
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** R02：20 人开户上限（与云端 lib.js 的 USER_LIMIT / Web / 鸿蒙一致）。 */
const val USER_LIMIT: Int = 20

/** 管理后台用户列表渲染项（白名单字段，照鸿蒙 AdminUserItem）。 */
data class AdminUserItem(
    val uid: String,
    val username: String,
    val status: String,
    val createdAt: String,
    val itemCount: Int,
)

/** 二次确认类型（照鸿蒙 confirmMode：'' | 'revoke' | 'disable' | 'delete'）。 */
enum class AdminConfirmKind { REVOKE_INVITE, DISABLE_USER, DELETE_USER }

/** 待确认动作 + 目标用户（邀请码作废无目标用户）。 */
data class AdminConfirm(val kind: AdminConfirmKind, val row: AdminUserItem? = null)

/** 管理后台状态（R02 / R12 / R13 / R14）。 */
data class AdminUiState(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val users: List<AdminUserItem> = emptyList(),
    /** 本次会话刚生成的一次性邀请码（空串表示无）。 */
    val inviteCode: String = "",
    /** 邀请码复制护栏倒计时（秒），>0 表示剪贴板持有邀请码。 */
    val copyCountdown: Int = 0,
    val myUid: String = "",
    val pendingConfirm: AdminConfirm? = null,
) {
    /** 是否已达开户上限（满员禁用生成按钮 + 琥珀提示条）。 */
    val isFull: Boolean get() = users.size >= USER_LIMIT

    /** 某人是否为当前登录管理员自己（防呆：自己那一行不渲染停用/删除按钮）。 */
    fun isSelf(uid: String): Boolean = myUid.isNotEmpty() && uid == myUid
}

/**
 * 管理后台 ViewModel（照鸿蒙 Admin.ets / Web AdminPage.tsx 语义移植）：
 *   R02 邀请码——生成（展示一次）/ 复制（30 秒自动清空剪贴板，R25 同语义）/ 作废（二次确认）。
 *   R12 用户列表——直连 RPC kb_admin_user_list；白名单字段渲染。
 *   R13 停用/启用——直连 PATCH kb_users 单列 status；停用需二次确认，启用直接执行。
 *   R14 删除数据——云函数 kbAdminDeleteUserData；二次确认含条目数与不可撤销警示。
 *
 * 界面纪律：不出现任何「查看密钥」入口；底栏常驻管理员免责声明（由 AdminScreen 渲染）。
 * 权限：入口仅在 role=admin 时显示；非管理员调用被服务端 is_admin() 拒绝，错误原样展示。
 */
class AdminViewModel(application: Application) : AndroidViewModel(application) {

    private val clipboard =
        application.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    private val _uiState = MutableStateFlow(AdminUiState())
    val uiState: StateFlow<AdminUiState> = _uiState.asStateFlow()

    private var copyJob: Job? = null

    init {
        // 记录当前登录身份（防呆判断用），并首次加载列表
        _uiState.update { it.copy(myUid = ServiceLocator.sessionStore.load()?.uid.orEmpty()) }
        reload()
    }

    /** 拉取用户列表（照鸿蒙 reload：失败原样展示服务端错误）。 */
    fun reload() {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, error = null) }
            try {
                val rows = ServiceLocator.adminRepository.listUsers()
                _uiState.update {
                    it.copy(loading = false, busy = false, users = rows.map(::toItem))
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(loading = false, busy = false, error = "加载用户列表失败：${e.message}")
                }
            }
        }
    }

    // ── R02：邀请码 ──

    /** 生成一次性邀请码（满员或忙时忽略）。 */
    fun createInvite() {
        if (_uiState.value.busy || _uiState.value.isFull) return
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, error = null, notice = null) }
            try {
                val invite = ServiceLocator.adminRepository.createInvite()
                _uiState.update {
                    it.copy(
                        busy = false,
                        inviteCode = invite.code,
                        notice = "已生成一次性邀请码，复制后发给新同事（用一次即失效）。",
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, error = "生成邀请码失败：${e.message}") }
            }
        }
    }

    /** 复制邀请码 + 30 秒自动清空剪贴板（重复复制重置倒计时，R25 同语义）。 */
    fun copyInvite() {
        val code = _uiState.value.inviteCode
        if (code.isEmpty()) return
        clipboard.setPrimaryClip(ClipData.newPlainText("KeyBox invite", code))
        copyJob?.cancel()
        copyJob = viewModelScope.launch {
            for (left in COPY_GUARD_SECONDS downTo 1) {
                _uiState.update {
                    it.copy(copyCountdown = left, notice = "已复制邀请码，$left 秒后自动清空剪贴板", error = null)
                }
                delay(1_000L)
            }
            clipboard.setPrimaryClip(ClipData.newPlainText("KeyBox invite", ""))
            _uiState.update { it.copy(copyCountdown = 0, notice = "剪贴板已自动清空", error = null) }
        }
    }

    /** 作废邀请码（二次确认后执行；仅本次会话刚生成的码可作废，kb_invites 对客户端零授权）。 */
    fun revokeInvite() {
        val code = _uiState.value.inviteCode
        if (code.isEmpty()) return
        _uiState.update { it.copy(pendingConfirm = null) }
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, error = null, notice = null) }
            try {
                ServiceLocator.adminRepository.revokeInvite(code)
                _uiState.update { it.copy(busy = false, inviteCode = "", notice = "邀请码已作废。") }
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, error = "作废邀请码失败：${e.message}") }
            }
        }
    }

    // ── R13：停用 / 启用 ──

    /** 切换启用/停用：active→disabled 需二次确认；其余（启用）直接执行（照 Web/鸿蒙）。 */
    fun toggleStatus(row: AdminUserItem) {
        if (_uiState.value.busy || _uiState.value.isSelf(row.uid)) return
        if (row.status == "active") {
            _uiState.update { it.copy(pendingConfirm = AdminConfirm(AdminConfirmKind.DISABLE_USER, row)) }
        } else {
            applyStatus(row, "active")
        }
    }

    /** 二次确认后的停用（由确认对话框调用，不再次弹确认）。 */
    fun confirmDisable(row: AdminUserItem) {
        if (_uiState.value.busy) return
        applyStatus(row, "disabled")
    }

    private fun applyStatus(row: AdminUserItem, next: String) {
        val verb = if (next == "disabled") "停用" else "启用"
        _uiState.update { it.copy(pendingConfirm = null) }
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, error = null, notice = null) }
            try {
                ServiceLocator.adminRepository.setUserStatus(row.uid, next)
                _uiState.update {
                    it.copy(busy = false, notice = "已$verb用户「${displayName(row)}」。")
                }
                reload()
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, error = "更新用户状态失败：${e.message}") }
            }
        }
    }

    // ── R14：删除用户数据 ──

    /** 请求删除（弹二次确认，含条目数与不可撤销警示）。 */
    fun requestDelete(row: AdminUserItem) {
        if (_uiState.value.busy || _uiState.value.isSelf(row.uid)) return
        _uiState.update { it.copy(pendingConfirm = AdminConfirm(AdminConfirmKind.DELETE_USER, row)) }
    }

    /** 确认删除用户数据（云函数，返回删除条数）。服务端 CANNOT_DELETE_SELF 原样展示。 */
    fun confirmDelete(row: AdminUserItem) {
        _uiState.update { it.copy(pendingConfirm = null) }
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, error = null, notice = null) }
            try {
                val deletedCount = ServiceLocator.adminRepository.deleteUserData(row.uid)
                _uiState.update {
                    it.copy(
                        busy = false,
                        notice = "已删除用户「${displayName(row)}」的 $deletedCount 条记录，该用户已置为 deleted。",
                    )
                }
                reload()
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, error = "删除用户数据失败：${e.message}") }
            }
        }
    }

    /** 请求作废邀请码（弹二次确认）。 */
    fun requestRevokeInvite() {
        if (_uiState.value.inviteCode.isEmpty() || _uiState.value.busy) return
        _uiState.update { it.copy(pendingConfirm = AdminConfirm(AdminConfirmKind.REVOKE_INVITE)) }
    }

    /** 取消二次确认。 */
    fun dismissConfirm() {
        _uiState.update { it.copy(pendingConfirm = null) }
    }

    override fun onCleared() {
        copyJob?.cancel()
    }

    private fun toItem(row: AdminUserRow): AdminUserItem = AdminUserItem(
        uid = row.uid,
        username = row.username,
        status = row.status,
        createdAt = row.createdAt,
        itemCount = row.itemCount,
    )

    private companion object {
        const val COPY_GUARD_SECONDS = 30
    }
}

/** 用户显示名兜底（空名显示「（未命名）」）。 */
internal fun displayName(row: AdminUserItem): String =
    row.username.ifEmpty { "（未命名）" }

/** 状态胶囊文案（照鸿蒙 statusPillText：active/deleted/其他=已停用）。 */
internal fun statusPillText(status: String): String = when (status) {
    "active" -> "正常"
    "deleted" -> "已删除"
    else -> "已停用"
}

/** 把 ISO 时间格式化为本地可读短串；解析失败原样返回（空串显示「—」）。 */
internal fun formatAdminTime(iso: String): String {
    if (iso.isEmpty()) return "—"
    return try {
        val instant = Instant.parse(iso)
        instant.atZone(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
    } catch (_: Exception) {
        iso
    }
}
