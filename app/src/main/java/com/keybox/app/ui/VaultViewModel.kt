package com.keybox.app.ui

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.keybox.app.data.KbSecretRow
import com.keybox.app.data.MasterSession
import com.keybox.app.data.SecretItem
import com.keybox.app.data.ServiceLocator
import com.keybox.app.data.maskKey
import com.keybox.app.data.parseSecretPayload
import com.keybox.core.crypto.KeyBoxCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 列表渲染项（照鸿蒙 VaultItem：单条解密失败不阻断整表）。 */
data class VaultItem(
    val id: Long,
    val site: String,
    val url: String,
    val website: String,
    val model: String,
    val key: String,
    val note: String,
    val tags: List<String>,
    val updatedAt: String,
    val decryptError: Boolean = false,
    val decryptErrMsg: String = "",
)

/** 密钥列表页状态。 */
data class VaultUiState(
    val items: List<VaultItem> = emptyList(),
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val status: String? = null,
    val statusIsError: Boolean = false,
    /** 复制护栏倒计时（秒），>0 表示剪贴板持有敏感内容。 */
    val copyCountdown: Int = 0,
)

/**
 * 密钥列表 ViewModel（A2 只读）：
 *   RDB REST 拉本人密文 → 本地解密（KB1）→ JSON 容错解析 → 渲染；
 *   代数不符/解密失败的条目标记错误，不阻断其他条目；
 *   复制密钥后 30 秒倒计时自动清空剪贴板（照鸿蒙/Web 的 R25 护栏语义）。
 */
class VaultViewModel(application: Application) : AndroidViewModel(application) {

    private val clipboard =
        application.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    private val _uiState = MutableStateFlow(VaultUiState())
    val uiState: StateFlow<VaultUiState> = _uiState.asStateFlow()

    private var copyJob: Job? = null

    init {
        load()
    }

    /** 首次加载。 */
    fun load() {
        fetchData(refreshing = false)
    }

    /** 下拉刷新：重新拉取并解密（简单版；完整双向同步 A4 再做）。 */
    fun refresh() {
        fetchData(refreshing = true)
    }

    private fun fetchData(refreshing: Boolean) {
        val raw = MasterSession.masterKeyRaw()
        if (raw == null) {
            _uiState.update {
                it.copy(loading = false, refreshing = false, status = "主密钥未解锁", statusIsError = true)
            }
            return
        }
        val session = ServiceLocator.sessionStore.load()
        if (session == null) {
            _uiState.update {
                it.copy(loading = false, refreshing = false, status = "登录态缺失", statusIsError = true)
            }
            return
        }
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    loading = !refreshing,
                    refreshing = refreshing,
                    status = null,
                    statusIsError = false,
                )
            }
            try {
                val rows = ServiceLocator.kbApi.fetchSecretRows(session.uid, session.accessToken)
                val keyEpoch = MasterSession.keyEpoch
                val items = withContext(Dispatchers.Default) {
                    rows.map { row -> decryptRow(row, raw, keyEpoch) }
                }
                _uiState.update {
                    it.copy(items = items, loading = false, refreshing = false, status = null)
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        loading = false,
                        refreshing = false,
                        status = "加载失败：${e.message}",
                        statusIsError = true,
                    )
                }
            }
        }
    }

    /** 解密单行密文 → 渲染项（代数不符/解密失败单条标记，不阻断整表，照鸿蒙 decryptRow）。 */
    private fun decryptRow(row: KbSecretRow, raw: ByteArray, keyEpoch: Int): VaultItem {
        val base = VaultItem(
            id = row.id,
            site = "",
            url = "",
            website = "",
            model = "",
            key = "",
            note = "",
            tags = emptyList(),
            updatedAt = row.updatedAt,
        )
        if (row.keyEpoch != keyEpoch) {
            return base.copy(
                decryptError = true,
                decryptErrMsg = "密文代数 ${row.keyEpoch} 与当前 $keyEpoch 不一致",
            )
        }
        return try {
            val item: SecretItem = parseSecretPayload(KeyBoxCrypto.decryptFromKb1(raw, row.payload))
            base.copy(
                site = item.site,
                url = item.url,
                website = item.website,
                model = item.model,
                key = item.key,
                note = item.note,
                tags = item.tags,
            )
        } catch (e: Exception) {
            base.copy(decryptError = true, decryptErrMsg = e.message ?: "解密失败")
        }
    }

    /** 复制密钥 + 30 秒自动清空剪贴板（重复复制重置倒计时）。 */
    fun copyKey(item: VaultItem) {
        if (item.decryptError || item.key.isEmpty()) return
        clipboard.setPrimaryClip(ClipData.newPlainText("KeyBox key", item.key))
        copyJob?.cancel()
        copyJob = viewModelScope.launch {
            for (left in COPY_GUARD_SECONDS downTo 1) {
                _uiState.update {
                    it.copy(copyCountdown = left, status = "已复制密钥，$left 秒后自动清空剪贴板", statusIsError = false)
                }
                delay(1_000L)
            }
            clipboard.setPrimaryClip(ClipData.newPlainText("KeyBox key", ""))
            _uiState.update { it.copy(copyCountdown = 0, status = "剪贴板已自动清空", statusIsError = false) }
        }
    }

    override fun onCleared() {
        copyJob?.cancel()
    }

    private companion object {
        const val COPY_GUARD_SECONDS = 30
    }
}
