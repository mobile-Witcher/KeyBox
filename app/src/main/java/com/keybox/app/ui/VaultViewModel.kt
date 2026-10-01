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
import com.keybox.app.data.parseTags
import com.keybox.app.data.serializeSecretPayload
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

/** 编辑/新增表单（独立于列表状态：网络失败时保留输入，用户不必重打）。 */
data class EditorForm(
    val site: String = "",
    val url: String = "",
    val website: String = "",
    val model: String = "",
    val key: String = "",
    val note: String = "",
    val tagsText: String = "",
)

/** 密钥列表页状态。 */
data class VaultUiState(
    val items: List<VaultItem> = emptyList(),
    /** 搜索过滤后的可见列表（本机内存过滤，零网络，照 Web filterItems / 鸿蒙 filteredItems）。 */
    val visibleItems: List<VaultItem> = emptyList(),
    val searchKw: String = "",
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val status: String? = null,
    val statusIsError: Boolean = false,
    /** 复制护栏倒计时（秒），>0 表示剪贴板持有敏感内容。 */
    val copyCountdown: Int = 0,
    // 编辑/新增对话框
    val showEditor: Boolean = false,
    /** null = 新增；非 null = 编辑该条。 */
    val editingItem: VaultItem? = null,
    val form: EditorForm = EditorForm(),
    val formError: String? = null,
    val submitting: Boolean = false,
    // 删除确认
    val deleteTarget: VaultItem? = null,
    val deleting: Boolean = false,
)

/**
 * 密钥列表 ViewModel：
 *   拉取解密渲染（A2）+ 本机搜索（R19，纯内存零网络）+ 增删改（A3，本机加密后上传）。
 *   搜索语义照 Web vault.ts filterItems / 鸿蒙 filteredItems：
 *   site/url/website/model/note/tags 小写包含；解密失败条目仅在有筛选条件时隐藏。
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

    /** 手动刷新：重新拉取并解密（完整双向同步 A4 再做）。 */
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
                _uiState.update { it.copy(items = items, loading = false, refreshing = false) }
                recomputeVisible()
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

    // ── 本机搜索（R19）：纯内存过滤，关键词不出设备 ──

    fun onSearchChange(value: String) {
        _uiState.update { it.copy(searchKw = value) }
        recomputeVisible()
    }

    /** 过滤后的可见列表：照 filterItems/filteredItems 语义，随 items 或关键词变化重算。 */
    private fun recomputeVisible() {
        val st = _uiState.value
        val kw = st.searchKw.trim().lowercase()
        val visible = st.items.filter { item ->
            if (item.decryptError) {
                // 解密失败的条目：仅在无筛选条件时保留展示（与 Web/鸿蒙一致）
                return@filter kw.isEmpty()
            }
            if (kw.isEmpty()) return@filter true
            val haystack = (item.site + " " + item.url + " " + item.website + " " + item.model +
                " " + item.note + " " + item.tags.joinToString(" ")).lowercase()
            haystack.contains(kw)
        }
        _uiState.update { it.copy(visibleItems = visible) }
    }

    // ── 新增 / 编辑 ──

    fun openNewEditor() {
        _uiState.update {
            it.copy(
                showEditor = true,
                editingItem = null,
                form = EditorForm(),
                formError = null,
            )
        }
    }

    /** 打开编辑：表单预填该条解密后的字段；解密失败条目不可编辑。 */
    fun openEditor(item: VaultItem) {
        if (item.decryptError) {
            _uiState.update {
                it.copy(status = "该条解密失败，无法编辑", statusIsError = true)
            }
            return
        }
        _uiState.update {
            it.copy(
                showEditor = true,
                editingItem = item,
                form = EditorForm(
                    site = item.site,
                    url = item.url,
                    website = item.website,
                    model = item.model,
                    key = item.key,
                    note = item.note,
                    tagsText = item.tags.joinToString(","),
                ),
                formError = null,
            )
        }
    }

    fun dismissEditor() {
        if (_uiState.value.submitting) return
        _uiState.update { it.copy(showEditor = false, formError = null) }
    }

    fun onSiteChange(v: String) = updateForm { it.copy(site = v) }
    fun onUrlChange(v: String) = updateForm { it.copy(url = v) }
    fun onWebsiteChange(v: String) = updateForm { it.copy(website = v) }
    fun onModelChange(v: String) = updateForm { it.copy(model = v) }
    fun onKeyChange(v: String) = updateForm { it.copy(key = v) }
    fun onNoteChange(v: String) = updateForm { it.copy(note = v) }
    fun onTagsChange(v: String) = updateForm { it.copy(tagsText = v) }

    private fun updateForm(transform: (EditorForm) -> EditorForm) {
        _uiState.update { it.copy(form = transform(it.form), formError = null) }
    }

    /**
     * 提交新增/编辑：serializePlain（tags 空省略键）→ encryptToKb1(masterKey) →
     * insert（带当前代数）/ PATCH update → 成功刷新列表；失败保留表单输入。
     */
    fun submitEditor() {
        val st = _uiState.value
        if (st.submitting) return
        val site = st.form.site.trim()
        val key = st.form.key.trim()
        if (site.isEmpty() || key.isEmpty()) {
            _uiState.update { it.copy(formError = "站点名称与密钥为必填项") }
            return
        }
        val masterRaw = MasterSession.masterKeyRaw()
        if (masterRaw == null) {
            _uiState.update { it.copy(formError = "主密钥未解锁，请重新解锁") }
            return
        }
        val session = ServiceLocator.sessionStore.load()
        if (session == null) {
            _uiState.update { it.copy(formError = "登录态缺失，请重新登录") }
            return
        }
        val editing = st.editingItem
        viewModelScope.launch {
            _uiState.update { it.copy(submitting = true, formError = null) }
            try {
                val plain = SecretItem(
                    site = site,
                    url = st.form.url.trim(),
                    website = st.form.website.trim(),
                    model = st.form.model.trim(),
                    key = key,
                    note = st.form.note.trim(),
                    tags = parseTags(st.form.tagsText),
                )
                val payload = withContext(Dispatchers.Default) { serializeSecretPayload(plain) }
                val enc = withContext(Dispatchers.Default) {
                    KeyBoxCrypto.encryptToKb1(masterRaw, payload)
                }
                val api = ServiceLocator.kbApi
                if (editing == null) {
                    api.insertSecretRow(enc, MasterSession.keyEpoch, session.accessToken)
                } else {
                    api.updateSecretRow(editing.id, enc, MasterSession.keyEpoch, session.accessToken)
                }
                _uiState.update { it.copy(showEditor = false, submitting = false, formError = null) }
                fetchData(refreshing = true)
            } catch (e: Exception) {
                // 失败路径：保留表单输入（state 未清空），只展示错误
                _uiState.update { it.copy(submitting = false, formError = e.message ?: "保存失败") }
            }
        }
    }

    // ── 删除 ──

    fun requestDelete(item: VaultItem) {
        _uiState.update { it.copy(deleteTarget = item) }
    }

    fun dismissDelete() {
        if (_uiState.value.deleting) return
        _uiState.update { it.copy(deleteTarget = null) }
    }

    /** 二次确认后的删除；失败（含代数 409）关闭对话框并在状态栏报错。 */
    fun confirmDelete() {
        val st = _uiState.value
        val target = st.deleteTarget ?: return
        if (st.deleting) return
        val session = ServiceLocator.sessionStore.load()
        if (session == null) {
            _uiState.update { it.copy(deleteTarget = null, status = "登录态缺失，请重新登录", statusIsError = true) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(deleting = true) }
            try {
                ServiceLocator.kbApi.deleteSecretRow(target.id, session.accessToken)
                _uiState.update { it.copy(deleteTarget = null, deleting = false) }
                fetchData(refreshing = true)
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        deleteTarget = null,
                        deleting = false,
                        status = "删除失败：${e.message}",
                        statusIsError = true,
                    )
                }
            }
        }
    }

    // ── 解密渲染 / 复制护栏（A2 语义保持） ──

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
