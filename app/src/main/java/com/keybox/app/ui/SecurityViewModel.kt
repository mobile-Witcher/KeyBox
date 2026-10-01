package com.keybox.app.ui

import android.app.Application
import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.keybox.app.data.BackupCodec
import com.keybox.app.data.BackupItem
import com.keybox.app.data.BiometricLockStore
import com.keybox.app.data.KbRotateItem
import com.keybox.app.data.MasterSession
import com.keybox.app.data.PinLockStore
import com.keybox.app.data.ServiceLocator
import com.keybox.app.data.parseSecretPayload
import com.keybox.app.data.serializeSecretPayload
import com.keybox.core.crypto.KeyBoxCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** 安全面板状态（R21 改主密码 / R22-R28 恢复码 / R29 备份）。 */
data class SecurityUiState(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    // kbGetMyRole 返回
    val kdfSalt: String = "",
    val kdfVerifier: String = "",
    val roleKeyEpoch: Int = 0,
    val recoverySalt: String = "",
    val recoveryBlob: String = "",
    val recoveryAckAt: String = "",
    // R21 表单
    val oldPwd: String = "",
    val newPwd: String = "",
    val confirmPwd: String = "",
    val recoveryCode: String = "",
    val showRotateConfirm: Boolean = false,
    val showExportConfirm: Boolean = false,
) {
    /** 本账号是否已设恢复码（salt 与 blob 成对）。 */
    val hasRecovery: Boolean get() = recoverySalt.isNotEmpty() && recoveryBlob.isNotEmpty()

    /** 有恢复码但未确认抄下（面板常驻提醒）。 */
    val recoveryUnacked: Boolean get() = hasRecovery && recoveryAckAt.isEmpty()
}

/**
 * 安全面板 ViewModel（照鸿蒙 SecurityPanel.ets 语义移植）：
 *   R21 改主密码——旧密码本机校验 → 全量旧 key 解密（一条失败整体中止）→ 新盐新 key 重加密
 *              → 新 verifier（+ 恢复码重包裹）→ 单请求 kbRotateMaster（失败尽力回滚）→ 会话保持。
 *   R28 恢复码——kbGetMyRole 读状态 → 未确认则 kbAckRecovery；无恢复码账号显示说明（不提供生成）。
 *   R29 备份——全量解密导出明文 JSON（SAF CreateDocument）/ 选文件导入（逐条重加密上传）。
 *
 * 明文纪律：主密码/恢复码只在 state 内存中短暂存在；成功后立即清空；绝不写日志。
 */
class SecurityViewModel(application: Application) : AndroidViewModel(application) {

    private val pinStore = PinLockStore(application)
    private val bioStore = BiometricLockStore(application)

    private val _uiState = MutableStateFlow(SecurityUiState())
    val uiState: StateFlow<SecurityUiState> = _uiState.asStateFlow()

    /** 独立导出的暂存内容（SAF 授权后写入）。 */
    private var pendingExport: List<BackupItem> = emptyList()
    private var pendingExportSkipped = 0

    init {
        refreshRole()
    }

    // ── R28：读本人角色/密钥参数/恢复码状态 ──

    fun refreshRole() {
        val session = ServiceLocator.sessionStore.load()
        if (session == null) {
            _uiState.update { it.copy(loading = false, error = "登录态缺失，请重新登录") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, error = null) }
            try {
                val role = ServiceLocator.kbApi.fetchMyRole(session.accessToken)
                _uiState.update {
                    it.copy(
                        loading = false,
                        kdfSalt = role.kdfSalt,
                        kdfVerifier = role.kdfVerifier,
                        roleKeyEpoch = role.keyEpoch,
                        recoverySalt = role.recoverySalt,
                        recoveryBlob = role.recoveryBlob,
                        recoveryAckAt = role.recoveryAckAt,
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(loading = false, error = "读取账号信息失败：${e.message}") }
            }
        }
    }

    /** R28：确认「已抄下并自行保管」（写 recovery_ack_at）。 */
    fun ackRecovery() {
        val session = ServiceLocator.sessionStore.load() ?: return
        _uiState.update { it.copy(busy = true, error = null, notice = null) }
        viewModelScope.launch {
            try {
                ServiceLocator.kbApi.ackRecoveryRemote(session.accessToken)
                refreshRole()
                _uiState.update { it.copy(busy = false, notice = "已记录：你已抄写并妥善保管恢复码。") }
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, error = e.message) }
            }
        }
    }

    // ── R21：改主密码 ──

    fun onOldPwd(v: String) = _uiState.update { it.copy(oldPwd = v, error = null, notice = null) }
    fun onNewPwd(v: String) = _uiState.update { it.copy(newPwd = v, error = null, notice = null) }
    fun onConfirmPwd(v: String) = _uiState.update { it.copy(confirmPwd = v, error = null, notice = null) }
    fun onRecoveryCode(v: String) = _uiState.update { it.copy(recoveryCode = v, error = null, notice = null) }

    fun dismissRotateConfirm() = _uiState.update { it.copy(showRotateConfirm = false) }
    fun dismissExportConfirm() = _uiState.update { it.copy(showExportConfirm = false) }

    /** 表单校验（通过后弹确认框；实际执行在 [doRotate]）。 */
    fun requestRotate() {
        val st = _uiState.value
        val error = when {
            st.oldPwd.isEmpty() || st.newPwd.isEmpty() -> "请填写原主密码与新主密码。"
            st.newPwd.length < 8 -> "新主密码至少 8 位。"
            st.newPwd != st.confirmPwd -> "两次输入的新主密码不一致。"
            st.hasRecovery && st.recoveryCode.trim().isEmpty() ->
                "本账号已设恢复码：请再次输入恢复码，以便用新主密钥重包裹（否则恢复码将失效）。"
            else -> null
        }
        if (error != null) {
            _uiState.update { it.copy(error = error, notice = null) }
            return
        }
        _uiState.update { it.copy(showRotateConfirm = true, error = null) }
    }

    /**
     * R21 全流程（事务性：本机重加密未全部成功前不调 kbRotateMaster；失败尽力回滚）。
     * ① 本机校验旧密码 → ② 全量旧 key 解密（一条失败整体中止）→ ③ 新盐新 key 重加密
     * → ④ 新 verifier（+ 恢复码重包裹）→ ⑤ 单请求提交 → ⑥ 失败尽力回滚 → ⑦ 成功更新内存与代数。
     */
    fun doRotate() {
        val st = _uiState.value
        _uiState.update { it.copy(showRotateConfirm = false, busy = true, error = null, notice = null) }
        viewModelScope.launch {
            try {
                val session = ServiceLocator.sessionStore.load()
                    ?: throw IllegalStateException("登录态缺失，请重新登录")
                val oldSalt = st.kdfSalt
                val oldVerifier = st.kdfVerifier

                // ① 本机校验原主密码（解 kdf_verifier 比对固定串）
                val oldRaw = withContext(Dispatchers.Default) {
                    KeyBoxCrypto.deriveKey(st.oldPwd, oldSalt)
                }
                val verifierPlain = runCatching {
                    KeyBoxCrypto.decryptFromKb1(oldRaw, oldVerifier)
                }.getOrDefault("")
                if (verifierPlain != KeyBoxCrypto.VERIFIER_PLAINTEXT) {
                    throw IllegalStateException("原主密码不正确。")
                }

                // ② 拉取服务端全量并用旧 key 逐条解密；任何一条失败 → 整体中止（绝不半新半旧）
                val rows = ServiceLocator.kbApi.fetchSecretRows(session.uid, session.accessToken)
                val ids = ArrayList<Long>(rows.size)
                val texts = ArrayList<String>(rows.size)
                for (r in rows) {
                    val text = try {
                        KeyBoxCrypto.decryptFromKb1(oldRaw, r.payload)
                    } catch (_: Exception) {
                        throw IllegalStateException(
                            "改主密码已整体中止：第 ${r.id} 条密文无法用旧主密码解开。请确认主密码正确后再试。",
                        )
                    }
                    ids.add(r.id)
                    texts.add(text)
                }

                // ③ 新盐 → 新 key → 全量重加密（纯内存）
                val newSalt = KeyBoxCrypto.generateSaltB64()
                val newRaw = withContext(Dispatchers.Default) {
                    KeyBoxCrypto.deriveKey(st.newPwd, newSalt)
                }
                val items = withContext(Dispatchers.Default) {
                    texts.mapIndexed { i, t -> KbRotateItem(ids[i], KeyBoxCrypto.encryptToKb1(newRaw, t)) }
                }

                // ④ 新校验串 + 可选恢复码重包裹（提交前完成，失败即中止、服务端未动）
                val newVerifier = withContext(Dispatchers.Default) {
                    KeyBoxCrypto.encryptToKb1(newRaw, KeyBoxCrypto.VERIFIER_PLAINTEXT)
                }
                val newBlob = if (st.hasRecovery) {
                    withContext(Dispatchers.Default) {
                        KeyBoxCrypto.wrapMasterKeyWithRecovery(
                            KeyBoxCrypto.normalizeRecoveryCode(st.recoveryCode),
                            st.recoverySalt,
                            newSalt,
                            newRaw,
                        )
                    }
                } else {
                    ""
                }

                // ⑤ 单请求提交整批重写（key_epoch+1 由服务端做）
                val newEpoch = try {
                    ServiceLocator.kbApi.rotateMasterRemote(
                        kdfSalt = newSalt,
                        kdfSaltPrev = oldSalt,
                        kdfVerifier = newVerifier,
                        recoveryBlob = newBlob,
                        items = items,
                        accessToken = session.accessToken,
                    )
                } catch (rotateErr: Exception) {
                    // ⑥ 失败：用旧材料整批覆盖回云端（尽力而为；函数原子，通常无需回滚）
                    runCatching {
                        ServiceLocator.kbApi.rotateMasterRemote(
                            kdfSalt = oldSalt,
                            kdfSaltPrev = oldSalt,
                            kdfVerifier = oldVerifier,
                            recoveryBlob = "",
                            items = rows.map { KbRotateItem(it.id, it.payload) },
                            accessToken = session.accessToken,
                        )
                    }
                    throw IllegalStateException(
                        "改主密码失败（已尝试回滚），主密码未变更，请稍后重试。原因：" + rotateErr.message,
                    )
                }

                // ⑦ 成功：更新内存主密钥与代数（会话保持，无需重登）；失效 PIN/生物解锁（包裹的是旧密钥）
                MasterSession.setMasterKey(newRaw, newEpoch)
                ServiceLocator.sessionStore.saveKeyEpoch(newEpoch)
                runCatching { pinStore.clearPinLock() }
                runCatching { bioStore.clear() }
                _uiState.update {
                    it.copy(
                        busy = false,
                        oldPwd = "",
                        newPwd = "",
                        confirmPwd = "",
                        recoveryCode = "",
                        notice = "主密码已更新（密钥代数 → $newEpoch）。请用新主密码解锁。其他设备下次打开需要重新登录。",
                    )
                }
                refreshRole()
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, error = e.message) }
            }
        }
    }

    // ── R29：导出（明文 JSON，SAF 保存） ──

    fun requestExport() {
        _uiState.update { it.copy(showExportConfirm = true, error = null, notice = null) }
    }

    /**
     * 独立导出准备：全量解密（代数不符/解密失败跳过）→ 暂存供 SAF 保存。
     * 返回 null 表示无内容/失败（UI 不弹保存框）。
     */
    fun prepareExport(onReady: (List<BackupItem>?) -> Unit) {
        val raw = MasterSession.masterKeyRaw()
        val session = ServiceLocator.sessionStore.load()
        if (raw == null || session == null) {
            _uiState.update { it.copy(busy = false, showExportConfirm = false, error = "主密钥未解锁或登录态缺失") }
            onReady(null)
            return
        }
        val keyEpoch = MasterSession.keyEpoch
        _uiState.update { it.copy(busy = true, showExportConfirm = false, error = null, notice = null) }
        viewModelScope.launch {
            try {
                val rows = ServiceLocator.kbApi.fetchSecretRows(session.uid, session.accessToken)
                var skipped = 0
                val out = ArrayList<BackupItem>(rows.size)
                for (r in rows) {
                    if (r.keyEpoch != keyEpoch) {
                        skipped += 1
                        continue
                    }
                    val backup = withContext(Dispatchers.Default) {
                        try {
                            val secret = parseSecretPayload(KeyBoxCrypto.decryptFromKb1(raw, r.payload))
                            BackupItem(
                                site = secret.site,
                                url = secret.url,
                                website = secret.website,
                                model = secret.model,
                                key = secret.key,
                                note = secret.note,
                                tags = secret.tags,
                                updatedAt = r.updatedAt,
                            )
                        } catch (_: Exception) {
                            null
                        }
                    }
                    if (backup == null) skipped += 1 else out.add(backup)
                }
                if (out.isEmpty()) {
                    _uiState.update { it.copy(busy = false, error = "没有可导出的密钥。") }
                    onReady(null)
                    return@launch
                }
                pendingExport = out
                pendingExportSkipped = skipped
                _uiState.update { it.copy(busy = false) }
                onReady(out)
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, error = "导出失败：${e.message}") }
                onReady(null)
            }
        }
    }

    /** SAF 授权后真正写文件。 */
    fun writeExport(contentResolver: ContentResolver, uri: Uri) {
        viewModelScope.launch {
            try {
                writeBackup(contentResolver, uri, pendingExport)
                val skipped = pendingExportSkipped
                _uiState.update {
                    it.copy(
                        notice = "已导出 ${pendingExport.size} 条到 JSON 文件" +
                            (if (skipped > 0) "（$skipped 条解密失败已跳过）" else "") +
                            "。明文文件，请妥善保管，建议用后尽快删除。",
                    )
                }
                pendingExport = emptyList()
                pendingExportSkipped = 0
            } catch (e: Exception) {
                _uiState.update { it.copy(error = "写入文件失败：${e.message}") }
            }
        }
    }

    /** 用户取消 SAF 保存：清空暂存。 */
    fun cancelExport() {
        _uiState.update { it.copy(busy = false, notice = "已取消导出。") }
        pendingExport = emptyList()
        pendingExportSkipped = 0
    }

    // ── R29：导入（SAF 选文件 → 解析校验 → 逐条重加密上传） ──

    fun importFromUri(contentResolver: ContentResolver, uri: Uri, onImported: () -> Unit) {
        val raw = MasterSession.masterKeyRaw()
        val session = ServiceLocator.sessionStore.load()
        if (raw == null || session == null) {
            _uiState.update { it.copy(busy = false, error = "主密钥未解锁或登录态缺失") }
            return
        }
        val keyEpoch = MasterSession.keyEpoch
        _uiState.update { it.copy(busy = true, error = null, notice = null) }
        viewModelScope.launch {
            try {
                val text = withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)?.use { it.readBytes() }?.toString(Charsets.UTF_8)
                        ?: throw IllegalStateException("无法读取所选文件")
                }
                val parsed = BackupCodec.decode(text)
                var imported = 0
                for (secret in parsed.items) {
                    val enc = withContext(Dispatchers.Default) {
                        KeyBoxCrypto.encryptToKb1(raw, serializeSecretPayload(secret))
                    }
                    ServiceLocator.kbApi.insertSecretRow(enc, keyEpoch, session.accessToken)
                    imported += 1
                }
                _uiState.update {
                    it.copy(busy = false, notice = "已导入 $imported 条（${parsed.skipped} 条格式非法已跳过）。")
                }
                onImported()
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, error = "导入失败：${e.message}") }
            }
        }
    }

    /** 用户取消导入：无副作用。 */
    fun cancelImport() {
        _uiState.update { it.copy(busy = false) }
    }

    // ── 备份文件写入 ──

    private suspend fun writeBackup(contentResolver: ContentResolver, uri: Uri, items: List<BackupItem>) {
        val text = BackupCodec.encode(Instant.now().toString(), items)
        withContext(Dispatchers.IO) {
            contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                ?: throw IllegalStateException("无法写入所选位置")
        }
    }

    /** 建议导出文件名（照鸿蒙 keybox-export-YYYYMMDD-HHmm.json）。 */
    fun suggestedExportName(): String {
        val stamp = Instant.now().atZone(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmm"))
        return "keybox-export-$stamp.json"
    }

    companion object {
        /** 改主密码确认必经文案（硬约束保留）。 */
        const val RELOGIN_CONFIRM_LINE: String =
            "此操作会使所有设备（含本机）退出登录，需要重新用手机号验证登录。"
    }
}
