package com.keybox.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * 分类过滤下拉（R18）· 紧凑单行形态（供与「计数 / 视图 / 同步」并排一行）：
 * 收起态显示「全部（N）▾」或「{分类}（N）▾」，展开列「全部」+各分类+条数，选中即收起；
 * 选中某分类后，菜单底部追加重命名 / 删除（R18）入口（不再占用行内横向空间）。
 */
@Composable
fun TagFilterBar(
    tagCounts: List<TagCount>,
    activeTag: String?,
    totalCount: Int,
    onSelect: (String?) -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val currentLabel = if (activeTag == null) {
        "全部（$totalCount）"
    } else {
        val count = tagCounts.firstOrNull { it.name == activeTag }?.count ?: 0
        "$activeTag（$count）"
    }

    Box(modifier = modifier) {
        Surface(
            onClick = { expanded = !expanded },
            enabled = enabled,
            shape = RoundedCornerShape(10.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            modifier = Modifier
                .fillMaxWidth()
                .height(40.dp),
        ) {
            Row(
                modifier = Modifier.padding(start = 12.dp, end = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = currentLabel,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                // 箭头固定尺寸：长分类名只压缩左侧文字，箭头不参与压缩
                Icon(
                    imageVector = Icons.Filled.ArrowDropDown,
                    contentDescription = "展开分类",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(24.dp),
                )
            }
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            DropdownMenuItem(
                text = { Text("全部（$totalCount）") },
                onClick = {
                    onSelect(null)
                    expanded = false
                },
            )
            tagCounts.forEach { tc ->
                DropdownMenuItem(
                    text = {
                        Text(
                            "${tc.name}（${tc.count}）",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    onClick = {
                        onSelect(tc.name)
                        expanded = false
                    },
                )
            }
            // 选中分类后提供重命名 / 删除（R18）——收进菜单，避免行内再占横向空间
            if (activeTag != null) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                DropdownMenuItem(
                    text = { Text("重命名分类") },
                    enabled = enabled,
                    onClick = {
                        expanded = false
                        onRename()
                    },
                )
                DropdownMenuItem(
                    text = { Text("删除分类", color = MaterialTheme.colorScheme.error) },
                    enabled = enabled,
                    onClick = {
                        expanded = false
                        onDelete()
                    },
                )
            }
        }
    }
}

/** 分类重命名对话框。 */
@Composable
fun TagRenameDialog(
    oldName: String,
    text: String,
    busy: Boolean,
    onTextChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("重命名分类") },
        text = {
            Column {
                Text(
                    "把分类「$oldName」重命名为：",
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = text,
                    onValueChange = onTextChange,
                    label = { Text("新分类名") },
                    singleLine = true,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !busy && text.trim().isNotEmpty()) {
                Text("保存")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) {
                Text("取消")
            }
        },
    )
}

/** 分类删除二次确认（显示影响条数）。 */
@Composable
fun TagDeleteDialog(
    tag: String,
    affectedCount: Int,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("删除分类") },
        text = {
            Text("删除分类「$tag」会从 $affectedCount 条密钥上移除该分类（密钥本身保留）。确认删除？")
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !busy) {
                Text("删除", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) {
                Text("取消")
            }
        },
    )
}

/**
 * 同步冲突裁决对话框（照鸿蒙 conflict 对话框）：
 * 每条冲突显示本机/服务端时间，整体二选一「保留本机」=重加密上传 /「用服务端」=解密覆盖。
 */
@Composable
fun ConflictDialog(
    conflicts: List<SyncConflict>,
    busy: Boolean,
    onDismiss: () -> Unit,
    onKeepLocal: () -> Unit,
    onUseRemote: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("检测到 ${conflicts.size} 处同步冲突") },
        text = {
            Column {
                Text(
                    "同一条密钥在本机与服务端都有更新（更新时间不一致）。请选择保留哪一侧：",
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Column(
                    modifier = Modifier
                        .heightIn(max = 200.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    conflicts.forEach { cf ->
                        Column(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                "#${cf.id} ${cf.site.ifEmpty { "（未命名）" }}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                "本机 ${fmtTime(cf.localUpdatedAt)} · 服务端 ${fmtTime(cf.remoteUpdatedAt)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onKeepLocal, enabled = !busy) {
                Text("保留本机")
            }
        },
        dismissButton = {
            TextButton(onClick = onUseRemote, enabled = !busy) {
                Text("用服务端")
            }
        },
    )
}

/** ISO 时间转本地可读短串；解析失败原样返回（照鸿蒙 fmtTime）。 */
private fun fmtTime(iso: String): String = try {
    java.time.Instant.parse(iso)
        .atZone(java.time.ZoneId.systemDefault())
        .format(java.time.format.DateTimeFormatter.ofPattern("MM-dd HH:mm"))
} catch (_: Exception) {
    iso
}
