package com.keybox.app.ui

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.keybox.app.R
import com.keybox.app.data.maskKey
import com.keybox.app.ui.theme.LocalAppearance
import kotlin.math.abs

/**
 * 密钥列表页（A4：分类过滤/管理 + 吸顶控制区 + 双向同步冲突）：
 *   固定控制区（页头整行 + 分类下拉 + 搜索框）不随列表滚动；
 *   列表/网格视图切换；冲突未处理时页内常驻可点击提示条。
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
                title = { Text("KeyBox") },
                actions = {
                    // 外观入口（B2）：深浅一键切换 + 调色盘（打开外观面板）。
                    // 图标带可见底色（surfaceVariant + outline 描边），确保不与背景同色。
                    TopBarRoundIconButton(
                        onClick = appearance.onToggleDark,
                        contentDescription = if (appearance.isDark) "切换到浅色" else "切换到深色",
                        painter = painterResource(
                            if (appearance.isDark) R.drawable.ic_light_mode else R.drawable.ic_dark_mode,
                        ),
                    )
                    TopBarRoundIconButton(
                        onClick = onOpenAppearance,
                        contentDescription = "外观",
                        painter = painterResource(R.drawable.ic_palette),
                    )
                    // 管理入口（仅 role=admin 显示；非 admin / 拉取失败一律不显示）
                    if (state.isAdmin) {
                        TextButton(onClick = onOpenAdmin, enabled = !busy) {
                            Text("管理")
                        }
                    }
                    // 安全面板入口（R21/R28/R29）
                    TextButton(onClick = onOpenSecurity, enabled = !busy) {
                        Text("安全")
                    }
                    TextButton(onClick = onLogout) {
                        Text("退出登录")
                    }
                },
            )
        },
        bottomBar = {
            Surface(shadowElevation = 8.dp) {
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                    state.status?.let { message ->
                        Text(
                            text = message,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (state.statusIsError) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            // ── 吸顶控制区（固定，不随列表滚动） ──
            // 页头整行：计数 / 视图切换 / 同步 / 新增
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "我的密钥（${state.visibleItems.size}/${state.items.size}）",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                // 视图切换（文本按钮：避免依赖精简图标集里不存在的网格图标）
                TextButton(onClick = viewModel::toggleView, enabled = !busy) {
                    Text(if (state.view == VaultView.LIST) "网格" else "列表")
                }
                IconButton(onClick = viewModel::runSync, enabled = !busy) {
                    if (state.syncing) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            Icons.Filled.Refresh,
                            contentDescription = "同步",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                IconButton(onClick = viewModel::openNewEditor, enabled = !busy) {
                    Icon(
                        Icons.Filled.Add,
                        contentDescription = "新增密钥",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }

            // 分类下拉 + 管理入口
            TagFilterBar(
                tagCounts = state.tagCounts,
                activeTag = state.activeTag,
                totalCount = state.items.size,
                onSelect = viewModel::selectTag,
                onRename = viewModel::openTagRename,
                onDelete = viewModel::openTagDelete,
                enabled = !busy,
            )

            // 搜索框（本机过滤，关键词不出设备）
            OutlinedTextField(
                value = state.searchKw,
                onValueChange = viewModel::onSearchChange,
                placeholder = { Text("搜索站点、接口地址、模型名…") },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                trailingIcon = {
                    if (state.searchKw.isNotEmpty()) {
                        IconButton(onClick = { viewModel.onSearchChange("") }) {
                            Icon(Icons.Filled.Close, contentDescription = "清除搜索")
                        }
                    }
                },
                singleLine = true,
                enabled = !busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )

            // 冲突未处理时页内常驻可点击提示条
            if (state.pendingConflicts.isNotEmpty()) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp)
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
                            tint = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "有 ${state.pendingConflicts.size} 处同步冲突待处理，点击裁决",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                }
            }

            // ── 可滚动列表区 ──
            Box(modifier = Modifier.fillMaxSize()) {
                when {
                    state.loading -> Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator()
                    }

                    state.visibleItems.isEmpty() -> Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = when {
                                state.items.isEmpty() -> "暂无密钥，点右上角 + 新增"
                                state.searchKw.isNotEmpty() -> "没有匹配「${state.searchKw.trim()}」的密钥"
                                state.activeTag != null -> "分类「${state.activeTag}」下暂无密钥"
                                else -> "暂无密钥"
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    state.view == VaultView.GRID -> LazyVerticalGrid(
                        columns = GridCells.Fixed(2),
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(state.visibleItems, key = { it.id }) { item ->
                            SecretGridCard(
                                item = item,
                                onCopy = { viewModel.copyKey(item) },
                                onEdit = { viewModel.openEditor(item) },
                                onDelete = { viewModel.requestDelete(item) },
                            )
                        }
                    }

                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(state.visibleItems, key = { it.id }) { item ->
                            SecretCard(
                                item = item,
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

@Composable
private fun SecretCard(
    item: VaultItem,
    onCopy: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        if (item.decryptError) {
            Row(
                modifier = Modifier.padding(start = 16.dp, top = 4.dp, end = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "解密失败 #${item.id}",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = item.decryptErrMsg,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                CardActionIcons(onEdit = onEdit, onDelete = onDelete)
            }
            return@Card
        }

        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Badge(item)
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                SecretBody(item = item, onCopy = onCopy)
            }
            CardActionIcons(onEdit = onEdit, onDelete = onDelete)
        }
    }
}

@Composable
private fun SecretGridCard(
    item: VaultItem,
    onCopy: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Badge(item)
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = item.site.ifEmpty { "未命名" },
                        style = MaterialTheme.typography.titleSmall,
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
            Text(
                text = maskKey(item.key),
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onCopy, enabled = item.key.isNotEmpty()) {
                    Text("复制")
                }
                Spacer(modifier = Modifier.weight(1f))
                IconButton(onClick = onEdit, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.Edit, contentDescription = "编辑", modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.Delete, contentDescription = "删除", modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

/** 列表卡片主体内容（站点名 / 副标题 / 模型 chip / 脱敏密钥 + 复制）。 */
@Composable
private fun SecretBody(item: VaultItem, onCopy: () -> Unit) {
    Text(
        text = item.site.ifEmpty { "未命名" },
        style = MaterialTheme.typography.titleMedium,
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
    Spacer(modifier = Modifier.height(4.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = maskKey(item.key),
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        TextButton(onClick = onCopy, enabled = item.key.isNotEmpty()) {
            Text("复制")
        }
    }
}

@Composable
private fun ModelChip(model: String) {
    Surface(
        shape = RoundedCornerShape(50),
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

@Composable
private fun CardActionIcons(onEdit: () -> Unit, onDelete: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        IconButton(onClick = onEdit, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Filled.Edit, contentDescription = "编辑", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
        }
        IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Filled.Delete, contentDescription = "删除", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun Badge(item: VaultItem) {
    val (badgeBg, badgeFg) = badgeColors(item)
    Box(
        modifier = Modifier
            .size(44.dp)
            .background(badgeBg, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = badgeChar(item),
            style = MaterialTheme.typography.titleMedium,
            color = badgeFg,
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

/** 分类着色：按分类（首个 tag，否则站点名）哈希从 M3 容器色轮换取色，颜色全走主题系统。 */
@Composable
private fun badgeColors(item: VaultItem): Pair<Color, Color> {
    val scheme = MaterialTheme.colorScheme
    val palette = listOf(
        scheme.primaryContainer to scheme.onPrimaryContainer,
        scheme.secondaryContainer to scheme.onSecondaryContainer,
        scheme.tertiaryContainer to scheme.onTertiaryContainer,
    )
    val category = item.tags.firstOrNull() ?: item.site
    val index = abs(category.hashCode()) % palette.size
    return palette[index]
}
