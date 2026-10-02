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
import java.text.Collator
import java.time.Instant
import java.util.Locale

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

/** 分类统计项（照 Web collectTags / 鸿蒙 TagCount）。 */
data class TagCount(val name: String, val count: Int)

/** 一处同步冲突（两边都有且 updated_at 不同；照鸿蒙 SyncConflictInfo）。 */
data class SyncConflict(
    val id: Long,
    val site: String,
    val localUpdatedAt: String,
    val remoteUpdatedAt: String,
    val remotePayload: String,
    val remoteKeyEpoch: Int,
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
    /** 分类 + 条数（只统计可解密条目，照 collectTags）。 */
    val tagCounts: List<TagCount> = emptyList(),
    /** 当前选中的分类；null = 全部。 */
    val activeTag: String? = null,
    /** 过滤后的可见列表（分类 + 搜索叠加，本机内存过滤，零网络）。 */
    val visibleItems: List<VaultItem> = emptyList(),
    val searchKw: String = "",
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val syncing: Boolean = false,
    val status: String? = null,
    val statusIsError: Boolean = false,
    /** 复制护栏倒计时（秒），>0 表示剪贴板持有敏感内容。 */
    val copyCountdown: Int = 0,
    // 编辑/新增对话框
    val showEditor: Boolean = false,
    val editingItem: VaultItem? = null,
    val form: EditorForm = EditorForm(),
    val formError: String? = null,
    val submitting: Boolean = false,
    // 删除确认
    val deleteTarget: VaultItem? = null,
    val deleting: Boolean = false,
    // 分类管理（R18）
    val tagBusy: Boolean = false,
    val showTagRename: Boolean = false,
    val tagRenameText: String = "",
    val showTagDelete: Boolean = false,
    // 双向同步冲突
    val pendingConflicts: List<SyncConflict> = emptyList(),
    val showConflictDialog: Boolean = false,
    /** 本人角色（R11）；仅当为 "admin" 时才显示「管理」入口。 */
    val myRole: String = "",
) {
    /** 是否管理员（R12 入口门禁：非 admin / 未拉取到一律不显示）。 */
    val isAdmin: Boolean get() = myRole == "admin"
}

/**
 * 密钥列表 ViewModel：
 *   拉取解密渲染（A2）+ 本机搜索（R19）+ CRUD（A3）+ 分类过滤/管理（R18）+ 双向同步（A4）。
 *   搜索/过滤语义照 Web vault.ts（filterItems/collectTags/mapTagChange）与鸿蒙 Vault.ets
 *   （filteredItems/tagCounts/applyTagChange/runSync），全程纯本机内存过滤，关键词不出设备。
 */
class VaultViewModel(application: Application) : AndroidViewModel(application) {

    private val clipboard =
        application.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    private val _uiState = MutableStateFlow(VaultUiState())
    val uiState: StateFlow<VaultUiState> = _uiState.asStateFlow()

    private var copyJob: Job? = null

    init {
        load()
        loadMyRole()
    }

    /**
     * 拉取本人角色（R11，复用 A5 已实现的 kbGetMyRole）。
     * 仅用于「管理」入口门禁：role=admin 才显示；拉取失败/非 admin 一律保持不显示（失败静默，不打扰用户）。
     */
    fun loadMyRole() {
        val session = ServiceLocator.sessionStore.load() ?: return
        viewModelScope.launch {
            try {
                val role = ServiceLocator.kbApi.fetchMyRole(session.accessToken)
                _uiState.update { it.copy(myRole = role.role) }
            } catch (_: Exception) {
                // 非 admin / 拉取失败：不显示入口（保持 myRole 为空）
                _uiState.update { it.copy(myRole = "") }
            }
        }
    }

    /** 首次加载。 */
    fun load() {
        fetchData(refreshing = false)
    }

    /** 手动刷新：重新拉取并解密（单向拉取；双向同步见 [runSync]）。 */
    fun refresh() {
        fetchData(refreshing = true)
    }

    private fun fetchData(refreshing: Boolean) {
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
                val items = loadRows()
                _uiState.update { it.copy(items = items, loading = false, refreshing = false) }
                recomputeDerived()
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

    /** 拉取 + 逐条解密（抛异常表示整表加载失败）。 */
    private suspend fun loadRows(): List<VaultItem> {
        val raw = MasterSession.masterKeyRaw()
            ?: throw IllegalStateException("主密钥未解锁")
        val session = ServiceLocator.sessionStore.load()
            ?: throw IllegalStateException("登录态缺失")
        val rows = ServiceLocator.kbApi.fetchSecretRows(session.uid, session.accessToken)
        val keyEpoch = MasterSession.keyEpoch
        return withContext(Dispatchers.Default) {
            rows.map { row -> decryptRow(row, raw, keyEpoch) }
        }
    }

    // ── 分类收集 + 过滤（R18/R19：纯内存，零网络） ──

    fun onSearchChange(value: String) {
        _uiState.update { it.copy(searchKw = value) }
        recomputeDerived()
    }

    /** 选择分类（null = 全部）。 */
    fun selectTag(tag: String?) {
        _uiState.update { it.copy(activeTag = tag) }
        recomputeDerived()
    }

    /** 重算分类统计与可见列表（items / 关键词 / 选中分类任一变化时调用）。 */
    private fun recomputeDerived() {
        val st = _uiState.value
        val counts = computeTagCounts(st.items)
        val kw = st.searchKw.trim().lowercase()
        val activeTag = st.activeTag?.takeIf { tag -> counts.any { it.name == tag } }
        val visible = st.items.filter { item ->
            if (item.decryptError) {
                // 解密失败的条目：仅在无标签筛选且无关键词时保留（Web filterItems / 鸿蒙 filteredItems 一致）
                return@filter activeTag == null && kw.isEmpty()
            }
            if (activeTag != null && activeTag !in item.tags) return@filter false
            if (kw.isEmpty()) return@filter true
            val haystack = (item.site + " " + item.url + " " + item.website + " " + item.model +
                " " + item.note + " " + item.tags.joinToString(" ")).lowercase()
            haystack.contains(kw)
        }
        _uiState.update { it.copy(tagCounts = counts, activeTag = activeTag, visibleItems = visible) }
    }

    /** 统计所有分类及出现次数（只统计可解密条目，按名称本地化排序，照 collectTags）。 */
    private fun computeTagCounts(items: List<VaultItem>): List<TagCount> {
        val counter = HashMap<String, Int>()
        for (item in items) {
            if (item.decryptError) continue
            for (tag in item.tags) {
                counter[tag] = (counter[tag] ?: 0) + 1
            }
        }
        val collator = Collator.getInstance(Locale.SIMPLIFIED_CHINESE)
        return counter.entries
            .map { TagCount(it.key, it.value) }
            .sortedWith(compareBy(collator) { it.name })
    }

    // ── R18：分类重命名 / 删除（照鸿蒙 applyTagChange：本机改 tags → 重加密 → 逐条上传） ──

    fun openTagRename() {
        val tag = _uiState.value.activeTag ?: return
        _uiState.update { it.copy(showTagRename = true, tagRenameText = tag) }
    }

    fun onTagRenameChange(value: String) {
        _uiState.update { it.copy(tagRenameText = value) }
    }

    fun dismissTagRename() {
        if (_uiState.value.tagBusy) return
        _uiState.update { it.copy(showTagRename = false) }
    }

    fun openTagDelete() {
        if (_uiState.value.activeTag == null) return
        _uiState.update { it.copy(showTagDelete = true) }
    }

    fun dismissTagDelete() {
        if (_uiState.value.tagBusy) return
        _uiState.update { it.copy(showTagDelete = false) }
    }

    /** 确认重命名：新名为空则视为取消。 */
    fun confirmTagRename() {
        val oldName = _uiState.value.activeTag ?: return
        val next = _uiState.value.tagRenameText.trim()
        if (next.isEmpty()) {
            _uiState.update { it.copy(showTagRename = false) }
            return
        }
        _uiState.update { it.copy(showTagRename = false) }
        applyTagChange(oldName, next)
    }

    /** 确认删除：从所有密钥 tags 移除该分类（tags 变空整键省略）。 */
    fun confirmTagDelete() {
        val oldName = _uiState.value.activeTag ?: return
        _uiState.update { it.copy(showTagDelete = false) }
        applyTagChange(oldName, null)
    }

    /**
     * 对选中分类执行重命名（next = 新名）或删除（next = null）。
     * 逐条重加密上传（encryptToKb1 → PATCH updateSecretRow），**单条失败收集后继续处理其余**；
     * 全部处理完统一提示（成功条数 + 失败条数）。照鸿蒙 applyTagChange。
     */
    private fun applyTagChange(oldName: String, next: String?) {
        val st = _uiState.value
        val changed = st.items.filter { !it.decryptError && oldName in it.tags }
        if (changed.isEmpty()) {
            selectTag(next)
            return
        }
        val raw = MasterSession.masterKeyRaw()
        val session = ServiceLocator.sessionStore.load()
        if (raw == null || session == null) {
            _uiState.update { it.copy(status = "主密钥未解锁或登录态缺失", statusIsError = true) }
            return
        }
        val keyEpoch = MasterSession.keyEpoch
        viewModelScope.launch {
            _uiState.update { it.copy(tagBusy = true, status = null) }
            val api = ServiceLocator.kbApi
            var okCount = 0
            val failures = ArrayList<String>()
            for (item in changed) {
                val newTags = mapTags(item.tags, oldName, next)
                try {
                    val enc = withContext(Dispatchers.Default) {
                        val plain = toPlain(item).copy(tags = newTags)
                        KeyBoxCrypto.encryptToKb1(raw, serializeSecretPayload(plain))
                    }
                    api.updateSecretRow(item.id, enc, keyEpoch, session.accessToken)
                    okCount += 1
                } catch (e: Exception) {
                    failures.add("#${item.id}：${e.message}")
                }
            }
            val action = if (next == null) "删除" else "重命名"
            val suffix = if (next == null) "" else "→「$next」"
            val baseMsg = "已$action 分类「$oldName」$suffix，共更新 $okCount 条密钥"
            val msg = if (failures.isEmpty()) {
                baseMsg
            } else {
                baseMsg + "；${failures.size} 条失败（${failures.joinToString("；").take(160)}）"
            }
            _uiState.update {
                it.copy(
                    tagBusy = false,
                    status = msg,
                    statusIsError = failures.isNotEmpty(),
                )
            }
            // 选中分类跟随变更（重命名 → 新名；删除 → 全部）
            if (_uiState.value.activeTag == oldName) {
                _uiState.update { it.copy(activeTag = next) }
            }
            runCatching { loadRows() }.onSuccess { items ->
                _uiState.update { it.copy(items = items) }
                recomputeDerived()
            }
        }
    }

    /** 重命名去重 / 删除移除；保持原顺序（照 mapTagChange）。 */
    private fun mapTags(tags: List<String>, oldName: String, next: String?): List<String> {
        val out = ArrayList<String>(tags.size)
        for (t in tags) {
            if (t == oldName) {
                if (next != null && next.isNotEmpty() && next !in out) out.add(next)
            } else if (t !in out) {
                out.add(t)
            }
        }
        return out
    }

    // ── A4：双向同步 + 冲突（照鸿蒙 runSync / resolveConflicts） ──

    /**
     * 双向同步：拉取服务端 → 按 updated_at 与本机逐条比对
     *   服务端有本机无 → 解密入库（pulled）；本机有服务端无 → 加密上传（pushed）；
     *   两边都有且时间戳不同 → 冲突（未决前保留本机版本）。
     * 完成提示「已同步 · N 条更新 · M 处冲突待处理」；网络失败仅报错不打断。
     */
    fun runSync() {
        val st = _uiState.value
        if (st.syncing) return
        val raw = MasterSession.masterKeyRaw()
        val session = ServiceLocator.sessionStore.load()
        if (raw == null || session == null) {
            _uiState.update { it.copy(status = "主密钥未解锁或登录态缺失", statusIsError = true) }
            return
        }
        val keyEpoch = MasterSession.keyEpoch
        viewModelScope.launch {
            _uiState.update { it.copy(syncing = true, status = null) }
            try {
                val api = ServiceLocator.kbApi
                val rows = api.fetchSecretRows(session.uid, session.accessToken)
                val remoteIds = rows.map { it.id }.toHashSet()
                val localMap = st.items.associateBy { it.id }

                val newItems = ArrayList<VaultItem>()
                val conflicts = ArrayList<SyncConflict>()
                var pulled = 0
                for (r in rows) {
                    val local = localMap[r.id]
                    when {
                        local == null -> {
                            newItems.add(decryptRow(r, raw, keyEpoch))
                            pulled += 1
                        }

                        !sameTimestamp(r.updatedAt, local.updatedAt) -> {
                            conflicts.add(
                                SyncConflict(
                                    id = r.id,
                                    site = local.site,
                                    localUpdatedAt = local.updatedAt,
                                    remoteUpdatedAt = r.updatedAt,
                                    remotePayload = r.payload,
                                    remoteKeyEpoch = r.keyEpoch,
                                ),
                            )
                            newItems.add(local) // 冲突未决前先保留本机版本
                        }

                        else -> newItems.add(local)
                    }
                }
                var pushed = 0
                for (it in st.items) {
                    if (it.id !in remoteIds && !it.decryptError) {
                        val enc = withContext(Dispatchers.Default) {
                            KeyBoxCrypto.encryptToKb1(raw, serializeSecretPayload(toPlain(it)))
                        }
                        api.insertSecretRow(enc, keyEpoch, session.accessToken)
                        pushed += 1
                        newItems.add(it) // 本机版本先保留，重载后以服务端新 id 为准
                    }
                }
                _uiState.update { it.copy(items = newItems, pendingConflicts = conflicts) }
                recomputeDerived()

                val msg = buildString {
                    append("已同步")
                    if (pulled + pushed > 0) append(" · ${pulled + pushed} 条更新")
                    if (conflicts.isNotEmpty()) append(" · ${conflicts.size} 处冲突待处理")
                }
                _uiState.update {
                    it.copy(
                        syncing = false,
                        status = msg,
                        statusIsError = false,
                        showConflictDialog = conflicts.isNotEmpty(),
                    )
                }
                // 重载以服务端为准（幂等）
                runCatching { loadRows() }.onSuccess { items ->
                    _uiState.update { it.copy(items = items) }
                    recomputeDerived()
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(syncing = false, status = "同步失败：${e.message}", statusIsError = true)
                }
            }
        }
    }

    fun openConflictDialog() {
        if (_uiState.value.pendingConflicts.isEmpty()) return
        _uiState.update { it.copy(showConflictDialog = true) }
    }

    fun dismissConflictDialog() {
        _uiState.update { it.copy(showConflictDialog = false) }
    }

    /** 冲突裁决：useRemote=true 用服务端覆盖本机；false 保留本机并重加密上传（照 resolveConflicts）。 */
    fun resolveConflicts(useRemote: Boolean) {
        val list = _uiState.value.pendingConflicts
        if (list.isEmpty()) {
            _uiState.update { it.copy(showConflictDialog = false) }
            return
        }
        val raw = MasterSession.masterKeyRaw()
        val session = ServiceLocator.sessionStore.load()
        if (raw == null || session == null) {
            _uiState.update { it.copy(status = "主密钥未解锁或登录态缺失", statusIsError = true) }
            return
        }
        val keyEpoch = MasterSession.keyEpoch
        viewModelScope.launch {
            _uiState.update { it.copy(syncing = true, showConflictDialog = false) }
            try {
                val api = ServiceLocator.kbApi
                val current = _uiState.value.items.toMutableList()
                var fail = 0
                for (cf in list) {
                    val idx = current.indexOfFirst { it.id == cf.id }
                    if (useRemote) {
                        val row = KbSecretRow(
                            id = cf.id,
                            payload = cf.remotePayload,
                            keyEpoch = cf.remoteKeyEpoch,
                            updatedAt = cf.remoteUpdatedAt,
                        )
                        val it = decryptRow(row, raw, keyEpoch)
                        if (idx >= 0) current[idx] = it else current.add(it)
                    } else if (idx >= 0) {
                        try {
                            val enc = withContext(Dispatchers.Default) {
                                KeyBoxCrypto.encryptToKb1(raw, serializeSecretPayload(toPlain(current[idx])))
                            }
                            api.updateSecretRow(cf.id, enc, keyEpoch, session.accessToken)
                        } catch (_: Exception) {
                            fail += 1
                        }
                    }
                }
                _uiState.update { it.copy(items = current, pendingConflicts = emptyList()) }
                recomputeDerived()
                val suffix = if (fail > 0) "（$fail 条上传失败）" else ""
                _uiState.update {
                    it.copy(
                        syncing = false,
                        status = "冲突已处理：${if (useRemote) "已采用服务端版本" else "已保留本机版本"}$suffix",
                        statusIsError = fail > 0,
                    )
                }
                runCatching { loadRows() }.onSuccess { items ->
                    _uiState.update { it.copy(items = items) }
                    recomputeDerived()
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(syncing = false, status = "冲突处理失败：${e.message}", statusIsError = true)
                }
            }
        }
    }

    /** updated_at 是否视作相同（先比原文，再比 ISO 时间戳，容格式差异；照 sameTimestamp）。 */
    private fun sameTimestamp(a: String, b: String): Boolean {
        if (a == b) return true
        return try {
            Instant.parse(a) == Instant.parse(b)
        } catch (_: Exception) {
            false
        }
    }

    // ── A3：新增 / 编辑 ──

    fun openNewEditor() {
        _uiState.update {
            it.copy(showEditor = true, editingItem = null, form = EditorForm(), formError = null)
        }
    }

    /** 打开编辑：表单预填该条解密后的字段；解密失败条目不可编辑。 */
    fun openEditor(item: VaultItem) {
        if (item.decryptError) {
            _uiState.update { it.copy(status = "该条解密失败，无法编辑", statusIsError = true) }
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
                val enc = withContext(Dispatchers.Default) {
                    KeyBoxCrypto.encryptToKb1(masterRaw, serializeSecretPayload(plain))
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

    // ── A3：删除 ──

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
            _uiState.update {
                it.copy(deleteTarget = null, status = "登录态缺失，请重新登录", statusIsError = true)
            }
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

    // ── 解密渲染 / 复制护栏 ──

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

    /** 列表项 → 明文结构（重加密用）。 */
    private fun toPlain(item: VaultItem): SecretItem = SecretItem(
        site = item.site,
        url = item.url,
        website = item.website,
        model = item.model,
        key = item.key,
        note = item.note,
        tags = item.tags,
    )

    /**
     * 复制任意字段到剪贴板 + 30 秒自动清空（R25 护栏，重复复制重置倒计时）。
     * 「复制站点/接口地址/…/密钥」共用此逻辑，统一走既有护栏，不新造一套。
     * @param text 待复制文本（为空则忽略）
     * @param label 状态提示中的字段名（如「密钥」「接口地址」）
     */
    fun copyProtected(text: String, label: String) {
        if (text.isEmpty()) return
        clipboard.setPrimaryClip(ClipData.newPlainText("KeyBox $label", text))
        copyJob?.cancel()
        copyJob = viewModelScope.launch {
            for (left in COPY_GUARD_SECONDS downTo 1) {
                _uiState.update {
                    it.copy(copyCountdown = left, status = "已复制$label，$left 秒后自动清空剪贴板", statusIsError = false)
                }
                delay(1_000L)
            }
            clipboard.setPrimaryClip(ClipData.newPlainText("KeyBox key", ""))
            _uiState.update { it.copy(copyCountdown = 0, status = "剪贴板已自动清空", statusIsError = false) }
        }
    }

    /** 复制密钥 + 30 秒自动清空剪贴板（走 [copyProtected]，R25 语义不变）。 */
    fun copyKey(item: VaultItem) {
        if (item.decryptError || item.key.isEmpty()) return
        copyProtected(item.key, "密钥")
    }

    override fun onCleared() {
        copyJob?.cancel()
    }

    private companion object {
        const val COPY_GUARD_SECONDS = 30
    }
}
