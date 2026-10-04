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
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.keybox.app.R
import com.keybox.app.ui.theme.LocalAppearance
import com.keybox.app.ui.theme.LocalKbColors
import kotlin.math.abs
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import com.keybox.app.data.maskKey

/**
 * 顶栏统一间距基准（改动 A）：品牌↔搜索、搜索↔首图标、图标↔图标、末图标↔屏边 全部取该值。
 * 注意：图标按钮为 40dp 触控盒（字形 20dp 居中），一律按「盒边缘」计间距，
 * 因此四个间隙视觉相等、不受字形尺寸影响。
 */
private val TopBarGap = 10.dp
private val TopBarHeight = 64.dp

/** 详情卡字段名列固定宽度（改动 B）——保证标签列对齐、值列不抖动。 */
private val FieldLabelWidth = 72.dp

/** 密钥遮挡占位（改动 B）：固定 8 个圆点，行高不随密钥长度变化。 */
private const val MaskedKey = "••••••••"

/**
 * 密钥列表页（B3 视觉打磨 + B4 交互动效 + 本轮：顶栏间距统一 / 列表卡片改为完整详情样式 / 移除网格视图）：
 *   顶栏：品牌 + 搜索胶囊 + 深浅（太阳）+ 皮肤（调色盘）+ 头像账户菜单（安全/管理/退出），
 *        四段间隙统一（见 [TopBarGap]）；
 *   吸顶控制区：分类下拉 + 计数 + 同步，合并为一行；
 *   列表：固定单列完整详情卡——标题+复制站点 / 标签 chips / 字段行（空值隐藏）/
 *        密钥行（遮挡+显示+复制）/ 底部编辑·删除；
 *   空态 / 骨架屏 / 状态胶囊 / FAB；列表项 animateItem 增删动效。
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
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
            VaultTopBar(
                searchKw = state.searchKw,
                onSearchChange = viewModel::onSearchChange,
                searchEnabled = !busy,
                isDark = appearance.isDark,
                onToggleDark = appearance.onToggleDark,
                onOpenAppearance = onOpenAppearance,
                uid = uid,
                isAdmin = state.isAdmin,
                menuEnabled = !busy,
                onOpenSecurity = onOpenSecurity,
                onOpenAdmin = onOpenAdmin,
                onLogout = onLogout,
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

                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 96.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(state.visibleItems, key = { it.id }) { item ->
                            SecretDetailCard(
                                item = item,
                                modifier = Modifier.animateItem(),
                                onCopyKey = { viewModel.copyKey(item) },
                                onCopyField = viewModel::copyProtected,
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
// 顶栏（改动 A：单一 Row + 统一间距）
// ---------------------------------------------------------------------------

/**
 * 顶栏：把「品牌 + 搜索 + 深浅 + 皮肤 + 头像」放进同一个 [Row]，用 [Arrangement.spacedBy] 统一间距，
 * 并在两端加同样大小的水平内边距。
 *
 * 为什么自己搭而不用 [androidx.compose.material3.TopAppBar]：TopAppBar 的 title/actions 两槽
 * 各自带默认内边距，导致「搜索↔首图标」的间隙与其余间隙不一致。改为单 Row 后：
 *   品牌↔搜索 = 搜索↔首图标 = 图标↔图标 = 末图标↔屏边 = [TopBarGap]，四段视觉相等。
 * 图标按钮统一按 40dp 盒边缘计间距（字形居中不参与测量），故不受字形尺寸影响。
 * 状态栏安全区由 [statusBarsPadding] 处理（Surface 底色铺满状态栏区域，避免白条）。
 */
@Composable
private fun VaultTopBar(
    searchKw: String,
    onSearchChange: (String) -> Unit,
    searchEnabled: Boolean,
    isDark: Boolean,
    onToggleDark: () -> Unit,
    onOpenAppearance: () -> Unit,
    uid: String,
    isAdmin: Boolean,
    menuEnabled: Boolean,
    onOpenSecurity: () -> Unit,
    onOpenAdmin: () -> Unit,
    onLogout: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.surface) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(TopBarHeight)
                .padding(horizontal = TopBarGap),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TopBarGap),
        ) {
            // 品牌（非加权，先测量，固定上限宽）
            Text(
                text = "KeyBox",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 72.dp),
            )
            // 搜索胶囊（weight 吸收剩余宽度；非加权图标永远拿到完整尺寸、不被挤没）
            SearchPill(
                value = searchKw,
                onValueChange = onSearchChange,
                enabled = searchEnabled,
                modifier = Modifier.weight(1f),
            )
            // 深浅一键切换（太阳/月亮）：图标带可见底色，避免与顶栏背景同色。
            TopBarRoundIconButton(
                onClick = onToggleDark,
                contentDescription = if (isDark) "切换到浅色" else "切换到深色",
                painter = painterResource(
                    if (isDark) R.drawable.ic_light_mode else R.drawable.ic_dark_mode,
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
                isAdmin = isAdmin,
                enabled = menuEnabled,
                onOpenSecurity = onOpenSecurity,
                onOpenAdmin = onOpenAdmin,
                onLogout = onLogout,
            )
        }
    }
}

/**
 * 顶栏圆形图标按钮：带可见底色（surfaceVariant）+ outline 描边，确保不与顶栏背景同色；
 * 图标用 [Painter]（自定义矢量，避免依赖精简图标集里不存在的调色盘/日/月图标）。
 * 盒子固定 40dp，水平间距由父 Row 统一提供（此处不加内外边距）。
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
 * 头像带可见底色（primaryContainer + outline 描边），不与顶栏背景同色；
 * 盒子固定 40dp，水平间距由父 Row 统一提供（此处不加内外边距）。
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
// 密钥详情卡（改动 B：LIST 视图默认样式；不弹层，详情直接在卡内）
// ---------------------------------------------------------------------------

/**
 * 密钥详情卡（LIST 视图）——把原「点开弹出的详情」直接铺进列表卡：
 *   标题行（徽章 + 站点名 + 域名 + 「复制站点」）；
 *   标签 chips（有分类才显示）；
 *   字段区（网址/官网/模型/备注，**空值整行隐藏**；标签列固定 [FieldLabelWidth]，值列 weight+Ellipsis，行尾复制）；
 *   密钥行（`••••••••` 遮挡 + 「显示/隐藏」切换 + 「复制」）；
 *   底部动作（编辑 = surfaceVariant 底 + onSurface 字；删除 = error 底 + onError 字）。
 * 所有复制动作都走 ViewModel 的 R25 护栏（[VaultViewModel.copyProtected]：30 秒自动清空剪贴板 + 倒计时）。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SecretDetailCard(
    item: VaultItem,
    modifier: Modifier = Modifier,
    onCopyKey: () -> Unit,
    onCopyField: (text: String, label: String) -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    // 密钥明/密状态：按条目 id 记忆，列表复用不错乱；默认始终遮挡。
    var revealed by remember(item.id) { mutableStateOf(false) }

    Card(modifier = modifier.fillMaxWidth()) {
        if (item.decryptError) {
            DecryptErrorRow(item = item, onDelete = onDelete)
            return@Card
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
        ) {
            // ── 标题行：徽章 + 站点/域名 + 复制站点 ──
            Row(verticalAlignment = Alignment.CenterVertically) {
                Badge(item = item, size = 40.dp)
                Spacer(modifier = Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = item.site.ifEmpty { "未命名" },
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val domain = domainText(item)
                    if (domain.isNotEmpty()) {
                        Text(
                            text = domain,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Spacer(modifier = Modifier.width(6.dp))
                CopyTextButton(
                    label = "复制站点",
                    enabled = item.site.isNotEmpty(),
                    onClick = { onCopyField(item.site, "站点") },
                )
            }

            // ── 标签 chips（有分类才显示；浅底 + 圆角，9 皮肤自适应） ──
            if (item.tags.isNotEmpty()) {
                Spacer(modifier = Modifier.height(10.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    item.tags.forEach { tag -> TagChip(tag) }
                }
            }

            // ── 字段区（网址/官网/模型/备注，空值整行隐藏） ──
            val hasField = item.url.isNotEmpty() || item.website.isNotEmpty() ||
                item.model.isNotEmpty() || item.note.isNotEmpty()
            if (hasField) {
                Spacer(modifier = Modifier.height(10.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Spacer(modifier = Modifier.height(4.dp))
                DetailField(label = "网址", value = item.url, onCopy = onCopyField)
                DetailField(label = "官网", value = item.website, onCopy = onCopyField)
                DetailField(label = "模型", value = item.model, onCopy = onCopyField)
                DetailField(label = "备注", value = item.note, onCopy = onCopyField)
            }

            // ── 密钥行（遮挡 + 显示/隐藏 + 复制） ──
            Spacer(modifier = Modifier.height(8.dp))
            KeyDetailRow(
                key = item.key,
                revealed = revealed,
                onToggleReveal = { revealed = !revealed },
                onCopy = onCopyKey,
            )

            // ── 底部动作：编辑（surfaceVariant）/ 删除（error） ──
            Spacer(modifier = Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Button(
                    onClick = onEdit,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                        contentColor = MaterialTheme.colorScheme.onSurface,
                    ),
                ) {
                    Icon(Icons.Filled.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("编辑", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Button(
                    onClick = onDelete,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                ) {
                    Icon(Icons.Filled.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("删除", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** 解密失败条目：错误信息 + 删除（不可编辑/复制）。 */
@Composable
private fun DecryptErrorRow(item: VaultItem, onDelete: () -> Unit) {
    Row(
        modifier = Modifier.padding(start = 16.dp, top = 12.dp, end = 8.dp, bottom = 12.dp),
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
}

/** 详情字段行：标签列固定宽 + 值列 weight(1f)+Ellipsis + 行尾复制图标；value 为空时整行不渲染。 */
@Composable
private fun DetailField(
    label: String,
    value: String,
    onCopy: (text: String, label: String) -> Unit,
) {
    if (value.isEmpty()) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            modifier = Modifier.width(FieldLabelWidth),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Spacer(modifier = Modifier.width(6.dp))
        CopyIconButton(
            contentDescription = "复制$label",
            onClick = { onCopy(value, label) },
        )
    }
}

/** 密钥行：等宽遮挡值 + 「显示/隐藏」切换 + 「复制」；图标与文本均走 R25 护栏。 */
@Composable
private fun KeyDetailRow(
    key: String,
    revealed: Boolean,
    onToggleReveal: () -> Unit,
    onCopy: () -> Unit,
) {
    val hasKey = key.isNotEmpty()
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "密钥",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            modifier = Modifier.width(FieldLabelWidth),
        )
        Surface(
            shape = RoundedCornerShape(6.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.weight(1f),
        ) {
            Text(
                text = if (revealed && hasKey) key else if (hasKey) MaskedKey else "（无密钥）",
                style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(modifier = Modifier.width(6.dp))
        RevealToggle(revealed = revealed, enabled = hasKey, onClick = onToggleReveal)
        Spacer(modifier = Modifier.width(2.dp))
        CopyIconButton(
            contentDescription = "复制密钥",
            enabled = hasKey,
            onClick = onCopy,
        )
    }
}

/** 「显示/隐藏」文本切换：仅在有关键才能点；开启用强调色。 */
@Composable
private fun RevealToggle(revealed: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val color = if (enabled) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
    }
    Text(
        text = if (revealed) "隐藏" else "显示",
        style = MaterialTheme.typography.labelMedium,
        color = color,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 4.dp),
    )
}

/** 行尾复制图标按钮（走 R25 护栏）；enabled=false 时降透明度但保留占位。 */
@Composable
private fun CopyIconButton(
    contentDescription: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val tint = MaterialTheme.colorScheme.onSurfaceVariant
        .copy(alpha = if (enabled) 1f else 0.4f)
    Box(
        modifier = Modifier
            .size(28.dp)
            .clip(RoundedCornerShape(6.dp))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_copy),
            contentDescription = contentDescription,
            tint = tint,
            modifier = Modifier.size(16.dp),
        )
    }
}

/** 「复制站点」文本按钮（紧凑）。 */
@Composable
private fun CopyTextButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    TextButton(onClick = onClick, enabled = enabled) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 标签 chip：浅底（surfaceVariant）+ outlineVariant 描边 + 圆角；9 皮肤自适应。 */
@Composable
private fun TagChip(tag: String) {
    Surface(
        shape = RoundedCornerShape(50),
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Text(
            text = tag,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// ---------------------------------------------------------------------------
// 网格紧凑卡（B3 样式，保持不变）
// ---------------------------------------------------------------------------

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

/** 网格卡底部三动作（复制 / 编辑 / 删除）：小型图标 + 文字，muted 色，删除用 error。 */
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

/** 网格卡副标题：域名 · 分类。 */
private fun VaultItem.subtitle(): String {
    val domain = domainText(this)
    val parts = buildList {
        if (domain.isNotEmpty()) add(domain)
        if (tags.isNotEmpty()) add(tags.joinToString("/"))
    }
    return parts.joinToString(" · ")
}

/** 域名：优先 url，回落 website。 */
private fun domainText(item: VaultItem): String = item.url.ifEmpty { item.website }

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
