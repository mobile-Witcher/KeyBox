package com.keybox.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

/**
 * 管理后台（全屏覆盖层承载，照鸿蒙 Admin.ets / Web AdminPage.tsx）：
 *   R02 邀请码（生成一次 / 复制 30s 清空 / 作废二次确认 + 已开户 N / 上限 20）；
 *   R12 用户列表（用户名 / 状态胶囊 / uid 等宽小字 / 注册时间 / 条目数 + 刷新）；
 *   R13 停用启用（停用需二次确认，含「会话将在 ≤1 分钟内失效」；启用直接执行）；
 *   R14 删除用户数据（二次确认含条目数与不可撤销警示）。
 *
 * 界面纪律：全页无任何「查看密钥」入口；底栏常驻管理员免责声明。
 * 防呆（不是权限）：自己那一行不渲染停用/删除按钮；服务端 is_admin()/CANNOT_DELETE_SELF 兜底。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(
    onBack: () -> Unit,
    onLogout: () -> Unit,
    viewModel: AdminViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("KeyBox · 管理后台") },
                actions = {
                    TextButton(onClick = onBack, enabled = !state.busy) { Text("返回密钥库") }
                    TextButton(onClick = onLogout) { Text("退出登录") }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Spacer(modifier = Modifier.height(2.dp))

            state.error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            state.notice?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }

            InviteSection(state = state, viewModel = viewModel)

            UserListSection(state = state, viewModel = viewModel)

            // 底栏纪律（与 Web/鸿蒙一致）：管理员看不到任何人的密钥内容
            Text(
                text = "管理员看不到任何人的密钥内容，仅可停用与删除。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 12.dp),
            )
        }
    }

    state.pendingConfirm?.let { confirm ->
        AdminConfirmDialog(
            confirm = confirm,
            onDismiss = viewModel::dismissConfirm,
            onRevoke = viewModel::revokeInvite,
            onDisable = { row -> viewModel.confirmDisable(row) },
            onDelete = { row -> viewModel.confirmDelete(row) },
        )
    }
}

/** 邀请码区（R02）。 */
@Composable
private fun InviteSection(state: AdminUiState, viewModel: AdminViewModel) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("邀请码", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                Text(
                    text = "已开户 ${state.users.size} / 上限 $USER_LIMIT",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (state.isFull) {
                Surface(
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = "已达 $USER_LIMIT 人上限，无法再开户。如需腾出名额，请「删除数据」将某用户软删（status=deleted）。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            }

            if (state.inviteCode.isEmpty()) {
                Button(
                    onClick = viewModel::createInvite,
                    enabled = !state.busy && !state.isFull,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (state.isFull) "已满员" else "生成邀请码")
                }
                Text(
                    "尚未生成邀请码。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(
                            text = state.inviteCode,
                            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                        )
                    }
                    TextButton(onClick = viewModel::copyInvite, enabled = !state.busy) {
                        Text(if (state.copyCountdown > 0) "已复制" else "复制")
                    }
                    TextButton(onClick = viewModel::requestRevokeInvite, enabled = !state.busy) {
                        Text("作废", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

/** 用户列表区（R12 / R13 / R14）。 */
@Composable
private fun UserListSection(state: AdminUiState, viewModel: AdminViewModel) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "用户（${state.users.size}）",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = viewModel::reload, enabled = !state.busy) { Text("刷新") }
        }

        when {
            state.loading -> Text(
                "正在读取用户列表…",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            state.users.isEmpty() -> Text(
                "暂无用户。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
            )

            else -> state.users.forEach { row ->
                AdminUserCard(row = row, state = state, viewModel = viewModel)
            }
        }
    }
}

/** 单个用户卡片（用户名 + 状态胶囊 + uid 等宽小字 + 注册时间 + 条目数 + 操作）。 */
@Composable
private fun AdminUserCard(row: AdminUserItem, state: AdminUiState, viewModel: AdminViewModel) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = displayName(row),
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                val active = row.status == "active"
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(50),
                ) {
                    Text(
                        text = statusPillText(row.status),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (active) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
            }

            Text(
                text = row.uid,
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )

            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "注册：" + formatAdminTime(row.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "条目 ${row.itemCount}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // 自己那一行：不渲染停用/删除按钮（防呆不是权限，服务端另有自检兜底）
            if (state.isSelf(row.uid)) {
                Text(
                    "（不能停用自己，请用另一个管理员操作）",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "（不能删除自己的数据，请联系另一位管理员）",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinedButton(
                        onClick = { viewModel.toggleStatus(row) },
                        enabled = !state.busy,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(if (row.status == "active") "停用" else "启用")
                    }
                    Button(
                        onClick = { viewModel.requestDelete(row) },
                        enabled = !state.busy,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("删除数据")
                    }
                }
            }
        }
    }
}

/** 二次确认对话框（照鸿蒙 ConfirmDialog：作废/停用/删除）。 */
@Composable
private fun AdminConfirmDialog(
    confirm: AdminConfirm,
    onDismiss: () -> Unit,
    onRevoke: () -> Unit,
    onDisable: (AdminUserItem) -> Unit,
    onDelete: (AdminUserItem) -> Unit,
) {
    val row = confirm.row
    val name = row?.let { displayName(it) }.orEmpty()
    val (title, body, actionLabel) = when (confirm.kind) {
        AdminConfirmKind.REVOKE_INVITE -> Triple(
            "作废邀请码？",
            "作废后该码不能再用于注册。确认作废？",
            "作废",
        )

        AdminConfirmKind.DISABLE_USER -> Triple(
            "确认停用？",
            "停用用户「$name」？其已登录会话将在 ≤1 分钟内失效。",
            "停用",
        )

        AdminConfirmKind.DELETE_USER -> Triple(
            "确认删除数据？",
            "确定删除用户「$name」的全部密钥数据？\n" +
                "将删除其 ${row?.itemCount ?: 0} 条记录，并把该用户置为 deleted（无法再登录）。\n" +
                "此操作不可撤销。",
            "删除",
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(body) },
        confirmButton = {
            TextButton(
                onClick = {
                    when (confirm.kind) {
                        AdminConfirmKind.REVOKE_INVITE -> onRevoke()
                        AdminConfirmKind.DISABLE_USER -> row?.let(onDisable)
                        AdminConfirmKind.DELETE_USER -> row?.let(onDelete)
                    }
                },
            ) {
                Text(actionLabel, color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}

/** 管理后台全屏承载的包裹（带背景，与 SecurityPanelOverlay 同模式）。 */
@Composable
fun AdminScreenOverlay(onBack: () -> Unit, onLogout: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize()) {
        AdminScreen(onBack = onBack, onLogout = onLogout)
    }
}
