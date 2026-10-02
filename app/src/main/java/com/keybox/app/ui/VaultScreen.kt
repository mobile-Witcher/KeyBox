package com.keybox.app.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.keybox.app.R
import com.keybox.app.data.maskKey
import com.keybox.app.ui.theme.LocalAppearance
import com.keybox.app.ui.theme.LocalKbColors
import kotlin.math.abs

/**
 * 密钥列表页（B3 视觉打磨 + B4 交互动效）：
 *   顶栏：品牌 + 深浅（太阳）+ 皮肤（调色盘）+ 头像账户菜单（安全/管理/退出）；
 *   吸顶控制区：计数 / 视图切换 / 同步 / 分类下拉 / 搜索胶囊；
 *   列表：分类语义色徽章 + 站名 + 副标题 + 模型 chip + 等宽密钥容器 + 底部三动作；
 *   空态 / 骨架屏 / 状态胶囊 / FAB；列表项 animateItem 增删动效。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultScreen(
    uid: String,
    onLogout: () -> Unit,
    onOpenSecurity: () -> Unit = {},
    onOpenAdmin: () -> Unit = {},
    onOpenAppearance: () -> Unit = {},
    dataVersion: Int = 0,
    viewModel: VaultViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val appearance = LocalAppearance.current
    val busy = state.syncing || state.tagBusy || state.submitting || state.deleting

    // 安全面板改主密码/导入后 dataVersion 递增 → 重载列表
    androidx.compose.runtime.LaunchedEffect(dataVersion) {
        if (dataVersion > 0) viewModel.refresh()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    // 品牌（左，固定上限宽）+ 搜索胶囊（weight 占中间）。
                    // 顶栏 Row 中「品牌/搜索」在 title 槽（weight 1f），右侧动作为非加权先测量，
                    // 故太阳/调色盘/头像永远拿到完整尺寸、不会被搜索框挤没。
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "KeyBox",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 72.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        SearchPill(
                            value = state.searchKw,
                            onValueChange = viewModel::onSearchChange,
                            enabled = !busy,
                            modifier = Modifier.weight(1f),
                        )
                    }
                },
                actions = {
                    // 深浅一键切换（太阳/月亮）：图标带可见底色，避免与顶栏背景同色。
                    TopBarRoundIconButton(
                        onClick = appearance.onToggleDark,
                        contentDescription = if (appearance.isDark) "切换到浅色" else "切换到深色",
                        painter = painterResource(
                            if (appearance.isDark) R.drawable.ic_light_mode else R.drawable.ic_dark_mode,
                        ),
                    )
                    // 皮肤（调色盘）
                    TopBarRoundIconButton(
                        onClick = onOpenAppearance,
                        contentDescription = "外观",
                        painter = painterResource(R.drawable.ic_palette),
                    )
                    // 账户菜单（B3：原「管理/安全/退出登录」三 TextButton 收敛于此）
                    AccountMenuButton(
                        uid = uid,
                        isAdmin = state.isAdmin,
                        enabled = !busy,
                        onOpenSecurity = onOpenSecurity,
                        onOpenAdmin = onOpenAdmin,
                        onLogout = onLogout,
                    )
                },
            )
        },
        floatingActionButton = {
            // 新增密钥（右下角 +）：primaryContainer 底，保证与任意皮肤背景可辨。
            FloatingActionButton(
                onClick = viewModel::openNewEditor,
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            ) {
                Icon(Icons.Filled.Add, contentDescription = "新增密钥")
            }
        },
        bottomBar = {
            StatusBar(state = state)
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            // ── 吸顶控制区（固定，不随列表滚动）：分类下拉 + 计数 + 视图切换 + 同步，合并为一行 ──
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // 分类下拉（紧凑形态，weight 占主；长分类名 Ellipsis，箭头不压缩）
                TagFilterBar(
                    tagCounts = state.tagCounts,
                    activeTag = state.activeTag,
                    totalCount = state.items.size,
                    onSelect = viewModel::selectTag,
                    onRename = viewModel::openTagRename,
                    onDelete = viewModel::openTagDelete,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                )
                Spacer(modifier = Modifier.width(8.dp))
                // 计数（固定、不参与压缩；极窄屏 Ellipsis 兜底）
                Text(
                    text = "我的密钥（${state.visibleItems.size}/${state.items.size}）",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 116.dp),
                )
                // 视图切换（图标按钮 40dp）
                IconButton(
                    onClick = viewModel::toggleView,
                    enabled = !busy,
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        painter = painterResource(
                            if (state.view == VaultView.LIST) R.drawable.ic_grid_view else R.drawable.ic_view_list,
                        ),
                        contentDescription = if (state.view == VaultView.LIST) "切换到网格" else "切换到列表",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp),
                    )
                }
                // 同步（图标按钮 40dp）
                IconButton(
                    onClick = viewModel::runSync,
                    enabled = !busy,
                    modifier = Modifier.size(40.dp),
                ) {
                    if (state.syncing) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            Icons.Filled.Refresh,
                            contentDescription = "同步",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            }

            // 冲突未处理时页内常驻可点击提示条（语义色 = warning）
            if (state.pendingConflicts.isNotEmpty()) {
                val kb = LocalKbColors.current
                Surface(
                    color = kb.warningContainer,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { viewModel.openConflictDialog() },
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Filled.Warning,
                            contentDescription = null,
                            tint = kb.onWarningContainer,
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "有 ${state.pendingConflicts.size} 处同步冲突待处理，点击裁决",
                            style = MaterialTheme.typography.bodySmall,
                            color = kb.onWarningContainer,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            // ── 可滚动列表区 ──
            Box(modifier = Modifier.fillMaxSize()) {
                when {
                    state.loading -> VaultSkeleton()

                    state.visibleItems.isEmpty() -> EmptyState(
                        itemsEmpty = state.items.isEmpty(),
                        searchKw = state.searchKw.trim(),
                        activeTag = state.activeTag,
                        onClearFilters = {
                            viewModel.onSearchChange("")
                            viewModel.selectTag(null)
                        },
                    )

                    state.view == VaultView.GRID -> LazyVerticalGrid(
                        columns = GridCells.Fixed(2),
                        modifier = Modifier.fillMaxSize(),
                        // 底部留出 FAB 不遮挡的 padding
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 96.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(state.visibleItems, key = { it.id }) { item ->
                            SecretGridCard(
                                item = item,
                                modifier = Modifier.animateItem(),
                                onCopy = { viewModel.copyKey(item) },
                                onEdit = { viewModel.openEditor(item) },
                                onDelete = { viewModel.requestDelete(item) },
                            )
                        }
                    }

                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 96.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(state.visibleItems, key = { it.id }) { item ->
                            SecretCard(
                                item = item,
                                modifier = Modifier.animateItem(),
                                onCopy = { viewModel.copyKey(item) },
                                onEdit = { viewModel.openEditor(item) },
                                onDelete = { viewModel.requestDelete(item) },
                            )
                        }
                    }
                }
            }
        }
    }

    // ── 新增/编辑对话框 ──
    if (state.showEditor) {
        EditorDialog(
            form = state.form,
            isEditing = state.editingItem != null,
            submitting = state.submitting,
            error = state.formError,
            onSiteChange = viewModel::onSiteChange,
            onUrlChange = viewModel::onUrlChange,
            onWebsiteChange = viewModel::onWebsiteChange,
            onModelChange = viewModel::onModelChange,
            onKeyChange = viewModel::onKeyChange,
            onNoteChange = viewModel::onNoteChange,
            onTagsChange = viewModel::onTagsChange,
            onDismiss = viewModel::dismissEditor,
            onSubmit = viewModel::submitEditor,
        )
    }

    // ── 删除二次确认（显示站点名） ──
    state.deleteTarget?.let { target ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = viewModel::dismissDelete,
            title = { Text("删除确认") },
            text = { Text("确定删除「${target.site.ifEmpty { "未命名" }}」吗？此操作不可恢复。") },
            confirmButton = {
                TextButton(onClick = viewModel::confirmDelete, enabled = !state.deleting) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = viewModel::dismissDelete, enabled = !state.deleting) {
                    Text("取消")
                }
            },
        )
    }

    // ── 分类重命名 / 删除（R18） ──
    if (state.showTagRename) {
        TagRenameDialog(
            oldName = state.activeTag.orEmpty(),
            text = state.tagRenameText,
            busy = state.tagBusy,
            onTextChange = viewModel::onTagRenameChange,
            onDismiss = viewModel::dismissTagRename,
            onConfirm = viewModel::confirmTagRename,
        )
    }
    if (state.showTagDelete) {
        TagDeleteDialog(
            tag = state.activeTag.orEmpty(),
            affectedCount = state.items.count { !it.decryptError && state.activeTag != null && state.activeTag in it.tags },
            busy = state.tagBusy,
            onDismiss = viewModel::dismissTagDelete,
            onConfirm = viewModel::confirmTagDelete,
        )
    }

    // ── 同步冲突裁决对话框 ──
    if (state.showConflictDialog && state.pendingConflicts.isNotEmpty()) {
        ConflictDialog(
            conflicts = state.pendingConflicts,
            busy = state.syncing,
            onDismiss = viewModel::dismissConflictDialog,
            onKeepLocal = { viewModel.resolveConflicts(useRemote = false) },
            onUseRemote = { viewModel.resolveConflicts(useRemote = true) },
        )
    }
}

// ---------------------------------------------------------------------------
// 顶栏
// ---------------------------------------------------------------------------

/**
 * 顶栏圆形图标按钮：带可见底色（surfaceVariant）+ outline 描边，确保不与顶栏背景同色；
 * 图标用 [Painter]（自定义矢量，避免依赖精简图标集里不存在的调色盘/日/月图标）。
 */
@Composable
private fun TopBarRoundIconButton(
    onClick: () -> Unit,
    contentDescription: String,
    painter: Painter,
) {
    val shape = CircleShape
    Box(
        modifier = Modifier
            .padding(horizontal = 4.dp)
            .size(40.dp)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(1.dp, MaterialTheme.colorScheme.outline, shape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painter,
            contentDescription = contentDescription,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
    }
}

/**
 * 顶栏内联搜索胶囊（本机过滤，关键词不出设备）：surfaceVariant 底 + outline 描边的胶囊，
 * 前导搜索图标 + 可编辑文本 +（有内容时）清除图标。用 BasicTextField 以在 64dp 顶栏内保持紧凑。
 */
@Composable
private fun SearchPill(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = modifier.height(40.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Filled.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Spacer(modifier = Modifier.width(6.dp))
            Box(
                modifier = Modifier.weight(1f),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (value.isEmpty()) {
                    Text(
                        text = "搜索站点、模型…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    enabled = enabled,
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodySmall.copy(
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (value.isNotEmpty()) {
                Spacer(modifier = Modifier.width(4.dp))
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "清除搜索",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .size(18.dp)
                        .clickable { onValueChange("") },
                )
            }
        }
    }
}

/**
 * 头像账户菜单（照 Web/鸿蒙端账户菜单形态）：点击头像弹下拉，
 * 含账户头部 + 安全 +（仅 admin）管理后台 + 退出登录。
 * 头像带可见底色（primaryContainer + outline 描边），不与顶栏背景同色。
 */
@Composable
private fun AccountMenuButton(
    uid: String,
    isAdmin: Boolean,
    enabled: Boolean,
    onOpenSecurity: () -> Unit,
    onOpenAdmin: () -> Unit,
    onLogout: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val shape = CircleShape

    Box {
        Box(
            modifier = Modifier
                .padding(horizontal = 4.dp)
                .size(40.dp)
                .clip(shape)
                .background(MaterialTheme.colorScheme.primaryContainer)
                .border(1.dp, MaterialTheme.colorScheme.outline, shape)
                .clickable { open = true },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.Person,
                contentDescription = "账户菜单",
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(22.dp),
            )
        }

        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            modifier = Modifier.width(240.dp),
        ) {
            // 账户头部（不可点击）
            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                Text(
                    text = "KeyBox 账户",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = uid.ifEmpty { "已登录" },
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            DropdownMenuItem(
                text = { Text("安全") },
                enabled = enabled,
                onClick = {
                    open = false
                    onOpenSecurity()
                },
            )
            if (isAdmin) {
                DropdownMenuItem(
                    text = { Text("管理后台") },
                    enabled = enabled,
                    onClick = {
                        open = false
                        onOpenAdmin()
                    },
                )
            }
            DropdownMenuItem(
                text = { Text("退出登录", color = MaterialTheme.colorScheme.error) },
                onClick = {
                    open = false
                    onLogout()
                },
            )
        }
    }
}

// ---------------------------------------------------------------------------
// 底栏状态（B3.4 语义色胶囊）
// ---------------------------------------------------------------------------

/** 状态语义类别。 */
private enum class StatusKind { SUCCESS, WARNING, ERROR, INFO }

/**
 * 底栏状态区：有瞬时状态时显示语义色胶囊；否则显示一条不抢视线的常驻状态。
 * 颜色取 LocalKbColors（success/warning）+ M3 error/primary，9 皮肤自适应。
 */
@Composable
private fun StatusBar(state: VaultUiState) {
    Surface(shadowElevation = 8.dp) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp),
        ) {
            val message = state.status
            if (message != null) {
                val kind = when {
                    state.copyCountdown > 0 -> StatusKind.INFO
                    state.statusIsError -> StatusKind.ERROR
                    state.pendingConflicts.isNotEmpty() -> StatusKind.WARNING
                    else -> StatusKind.SUCCESS
                }
                StatusPill(kind = kind, text = message)
            } else {
                val kb = LocalKbColors.current
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(kb.success),
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = if (state.syncing) {
                            "同步中…"
                        } else {
                            "已解锁 · 共 ${state.items.size} 条密钥"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun StatusPill(kind: StatusKind, text: String) {
    val scheme = MaterialTheme.colorScheme
    val kb = LocalKbColors.current
    val (bg, fg) = when (kind) {
        StatusKind.SUCCESS -> kb.successContainer to kb.onSuccessContainer
        StatusKind.WARNING -> kb.warningContainer to kb.onWarningContainer
        StatusKind.ERROR -> scheme.errorContainer to scheme.onErrorContainer
        StatusKind.INFO -> scheme.primaryContainer to scheme.onPrimaryContainer
    }
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = bg,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(fg),
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium,
                color = fg,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// 空态 / 骨架屏
// ---------------------------------------------------------------------------

@Composable
private fun EmptyState(
    itemsEmpty: Boolean,
    searchKw: String,
    activeTag: String?,
    onClearFilters: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = if (itemsEmpty) Icons.Filled.Lock else Icons.Filled.Search,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(48.dp),
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = when {
                itemsEmpty -> "还没有密钥"
                searchKw.isNotEmpty() -> "没有找到匹配「$searchKw」的密钥"
                activeTag != null -> "分类「$activeTag」下还没有密钥"
                else -> "暂无密钥"
            },
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = if (itemsEmpty) "点右下角 + 添加第一条" else "换个关键词，或清除当前筛选",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        if (!itemsEmpty && (searchKw.isNotEmpty() || activeTag != null)) {
            Spacer(modifier = Modifier.height(10.dp))
            TextButton(onClick = onClearFilters) { Text("清除筛选") }
        }
    }
}

/** 首次加载骨架屏：3 个灰块卡片 + 微光呼吸（替代转圈）。 */
@Composable
private fun VaultSkeleton() {
    val transition = rememberInfiniteTransition(label = "vault-skeleton")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.9f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "vault-skeleton-alpha",
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        repeat(3) {
            SkeletonCard(alpha = alpha)
        }
    }
}

@Composable
private fun SkeletonCard(alpha: Float) {
    val blockColor = MaterialTheme.colorScheme.surfaceVariant
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .alpha(alpha)
                        .background(blockColor),
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(0.5f)
                            .height(14.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .alpha(alpha)
                            .background(blockColor),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(0.8f)
                            .height(10.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .alpha(alpha)
                            .background(blockColor),
                    )
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(28.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .alpha(alpha)
                    .background(blockColor),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// 密钥卡片（B3.1）
// ---------------------------------------------------------------------------

@Composable
private fun SecretCard(
    item: VaultItem,
    modifier: Modifier = Modifier,
    onCopy: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(modifier = modifier.fillMaxWidth()) {
        if (item.decryptError) {
            Row(
                modifier = Modifier.padding(start = 16.dp, top = 8.dp, end = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "解密失败 #${item.id}",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.error,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = item.decryptErrMsg,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
                    Icon(
                        imageVector = Icons.Filled.Delete,
                        contentDescription = "删除",
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            return@Card
        }

        Column(modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Badge(item = item, size = 44.dp)
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    SecretTitle(item)
                }
            }
            Spacer(modifier = Modifier.height(10.dp))
            KeyChip(item.key)
        }
        HorizontalDivider(
            modifier = Modifier.padding(horizontal = 14.dp),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        CardActionsRow(item = item, onCopy = onCopy, onEdit = onEdit, onDelete = onDelete)
    }
}

@Composable
private fun SecretGridCard(
    item: VaultItem,
    modifier: Modifier = Modifier,
    onCopy: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Badge(item = item, size = 38.dp)
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = item.site.ifEmpty { "未命名" },
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val subtitle = item.subtitle()
                    if (subtitle.isNotEmpty()) {
                        Text(
                            text = subtitle,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            if (item.decryptError) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = item.decryptErrMsg,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                return@Column
            }
            if (item.model.isNotEmpty()) {
                Spacer(modifier = Modifier.height(6.dp))
                ModelChip(item.model)
            }
            Spacer(modifier = Modifier.height(6.dp))
            KeyChip(item.key)
        }
        HorizontalDivider(
            modifier = Modifier.padding(horizontal = 12.dp),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        CardActionsRow(item = item, onCopy = onCopy, onEdit = onEdit, onDelete = onDelete)
    }
}

/** 卡片标题块：站点名 + 副标题 + 模型 chip。 */
@Composable
private fun SecretTitle(item: VaultItem) {
    Text(
        text = item.site.ifEmpty { "未命名" },
        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
    val subtitle = item.subtitle()
    if (subtitle.isNotEmpty()) {
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
    if (item.model.isNotEmpty()) {
        Spacer(modifier = Modifier.height(4.dp))
        ModelChip(item.model)
    }
}

/** 脱敏密钥容器：等宽字体 + surface 底小圆角。 */
@Composable
private fun KeyChip(key: String) {
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = maskKey(key),
            style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 模型 chip：secondaryContainer 底 + 小圆角。 */
@Composable
private fun ModelChip(model: String) {
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
    ) {
        Text(
            text = model,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 卡片底部三动作（复制 / 编辑 / 删除）：小型图标 + 文字，muted 色，删除用 error。 */
@Composable
private fun CardActionsRow(
    item: VaultItem,
    onCopy: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val danger = MaterialTheme.colorScheme.error
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ActionItem(
            label = "复制",
            painter = painterResource(R.drawable.ic_copy),
            color = muted,
            enabled = item.key.isNotEmpty(),
            onClick = onCopy,
        )
        Spacer(modifier = Modifier.weight(1f))
        ActionItem(
            label = "编辑",
            painter = rememberVectorPainter(Icons.Filled.Edit),
            color = muted,
            onClick = onEdit,
        )
        Spacer(modifier = Modifier.width(4.dp))
        ActionItem(
            label = "删除",
            painter = rememberVectorPainter(Icons.Filled.Delete),
            color = danger,
            onClick = onDelete,
        )
    }
}

@Composable
private fun ActionItem(
    label: String,
    painter: Painter,
    color: Color,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = painter,
            contentDescription = null,
            tint = color.copy(alpha = if (enabled) 1f else 0.4f),
            modifier = Modifier.size(16.dp),
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = color.copy(alpha = if (enabled) 1f else 0.4f),
            maxLines = 1,
        )
    }
}

/** 品牌徽章：站点首字，按分类语义色着色（LocalKbColors + M3 容器色轮换，9 皮肤自适应）。 */
@Composable
private fun Badge(item: VaultItem, size: Dp) {
    val (badgeBg, badgeFg) = badgeColors(item)
    Box(
        modifier = Modifier
            .size(size)
            .background(badgeBg, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = badgeChar(item),
            style = MaterialTheme.typography.titleMedium,
            color = badgeFg,
            maxLines = 1,
        )
    }
}

/** 副标题：域名 · 分类。 */
private fun VaultItem.subtitle(): String {
    val domain = url.ifEmpty { website }
    val parts = buildList {
        if (domain.isNotEmpty()) add(domain)
        if (tags.isNotEmpty()) add(tags.joinToString("/"))
    }
    return parts.joinToString(" · ")
}

/** 徽章字符：站点名首字（大写），空名兜底「?」。 */
private fun badgeChar(item: VaultItem): String =
    item.site.trim().firstOrNull()?.uppercase() ?: "?"

/**
 * 分类着色：按分类（首个 tag，否则站点名）哈希从「primary/success/warning/error/secondary」
 * 容器色轮换取色（同分类同色、不同分类轮换）；success/warning 来自 LocalKbColors，9 皮肤自适应。
 */
@Composable
private fun badgeColors(item: VaultItem): Pair<Color, Color> {
    val scheme = MaterialTheme.colorScheme
    val kb = LocalKbColors.current
    val palette = listOf(
        scheme.primaryContainer to scheme.onPrimaryContainer,
        kb.successContainer to kb.onSuccessContainer,
        kb.warningContainer to kb.onWarningContainer,
        scheme.errorContainer to scheme.onErrorContainer,
        scheme.secondaryContainer to scheme.onSecondaryContainer,
    )
    val category = item.tags.firstOrNull() ?: item.site
    val index = abs(category.hashCode()) % palette.size
    return palette[index]
}
