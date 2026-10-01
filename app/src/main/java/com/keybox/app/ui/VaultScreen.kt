package com.keybox.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PullToRefreshBox
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.keybox.app.data.maskKey
import kotlin.math.abs

/**
 * 密钥列表页（A2 只读）：下拉刷新 → 解密渲染；复制密钥走 30 秒剪贴板护栏。
 * A3 批才做新增/编辑/删除。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultScreen(
    uid: String,
    onLogout: () -> Unit,
    viewModel: VaultViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("KeyBox")
                        Text(
                            text = "已解锁 · ${state.items.size} 条密钥",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                actions = {
                    TextButton(onClick = onLogout) {
                        Text("退出登录")
                    }
                },
            )
        },
        bottomBar = {
            state.status?.let { message ->
                Surface(shadowElevation = 8.dp) {
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (state.statusIsError) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = viewModel::refresh,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                state.loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }

                state.items.isEmpty() -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "暂无密钥，下拉刷新试试",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(state.items, key = { it.id }) { item ->
                        SecretCard(item = item, onCopy = { viewModel.copyKey(item) })
                    }
                }
            }
        }
    }
}

@Composable
private fun SecretCard(item: VaultItem, onCopy: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        if (item.decryptError) {
            // 解密失败的条目：标记原因，不阻断其他条目（照鸿蒙语义）
            Column(modifier = Modifier.padding(16.dp)) {
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
            return@Card
        }

        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 品牌徽章：站点首字，按分类着色（M3 容器色轮换）
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

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
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
                    Surface(
                        shape = RoundedCornerShape(50),
                        color = MaterialTheme.colorScheme.secondaryContainer,
                    ) {
                        Text(
                            text = item.model,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
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
        }
    }
}

/** 副标题：域名 · 分类（照任务口径「域名·分类」）。 */
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
private fun badgeColors(item: VaultItem): Pair<androidx.compose.ui.graphics.Color, androidx.compose.ui.graphics.Color> {
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
