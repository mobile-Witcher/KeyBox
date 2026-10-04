package com.keybox.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

/**
 * 安全面板（全屏承载，照鸿蒙 SecurityPanel.ets / Web SecurityPanel.tsx）：
 *   R28 恢复码状态与确认 / R29 备份导出导入 / R21 改主密码。
 * 明文纪律：主密码/恢复码只在 state 内存短暂存在，成功后立即清空。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecurityPanel(
    onClose: () -> Unit,
    onDataChanged: () -> Unit,
    viewModel: SecurityViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    // SAF：导出（用户选保存位置）与导入（用户选文件）
    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        if (uri != null) {
            viewModel.writeExport(context.contentResolver, uri)
        } else {
            viewModel.cancelExport()
        }
    }
    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            viewModel.importFromUri(context.contentResolver, uri, onDataChanged)
        } else {
            viewModel.cancelImport()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("安全") },
                actions = {
                    TextButton(onClick = onClose, enabled = !state.busy) { Text("关闭") }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Spacer(modifier = Modifier.height(4.dp))

            if (state.loading) {
                CircularProgressIndicator(modifier = Modifier.height(24.dp))
            }

            state.error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            state.notice?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }

            // ── R28：恢复码状态 ──
            SectionTitle("恢复码（R28）")
            when {
                state.recoveryUnacked -> {
                    Text(
                        "你还没有确认已抄下恢复码。恢复码用于在主密码遗忘时找回数据；若未妥善保管，将无法恢复。确认后此提醒会消失。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Button(
                        onClick = viewModel::ackRecovery,
                        enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("我已抄下并自行保管")
                    }
                }

                state.hasRecovery -> Text(
                    "恢复码已确认妥善保管。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )

                else -> Text(
                    "本账号尚未设置恢复码。恢复码在网页端注册 / 初始化账号时生成；遗忘主密码时可用它找回数据（存量账号无法后补）。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            HorizontalDivider()

            // ── R29：备份导出 / 导入 ──
            SectionTitle("备份导出 / 导入（R29）")
            Text(
                "导出为明文 JSON 文件（含全部密钥明文与接口地址），导入时逐条用当前主密钥重新加密上传。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedButton(
                    onClick = {
                        viewModel.prepareExport { items ->
                            if (items != null) exportLauncher.launch(viewModel.suggestedExportName())
                        }
                    },
                    enabled = !state.busy,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(if (state.busy) "处理中…" else "导出备份")
                }
                OutlinedButton(
                    onClick = { importLauncher.launch(arrayOf("application/json")) },
                    enabled = !state.busy,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("导入备份")
                }
            }

            HorizontalDivider()

            // ── R21：改主密码 ──
            SectionTitle("修改主密码（R21）")
            Text(
                "本机会用原主密码逐条解密、用新主密码重加密后再整批提交；任何一条失败都会整体中止，不会产生「半新半旧」。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "注意：" + SecurityViewModel.RELOGIN_CONFIRM_LINE,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
            OutlinedTextField(
                value = state.oldPwd,
                onValueChange = viewModel::onOldPwd,
                label = { Text("原主密码") },
                singleLine = true,
                enabled = !state.busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = state.newPwd,
                onValueChange = viewModel::onNewPwd,
                label = { Text("新主密码（至少 8 位）") },
                singleLine = true,
                enabled = !state.busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = state.confirmPwd,
                onValueChange = viewModel::onConfirmPwd,
                label = { Text("确认新主密码") },
                singleLine = true,
                enabled = !state.busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            if (state.hasRecovery) {
                OutlinedTextField(
                    value = state.recoveryCode,
                    onValueChange = viewModel::onRecoveryCode,
                    label = { Text("恢复码（用于重包裹，保持其可用）") },
                    singleLine = true,
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Button(
                onClick = viewModel::requestRotate,
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.busy) "处理中…" else "修改主密码")
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }

    // ── 改主密码确认对话框（硬约束：保留「所有设备退出登录」提示） ──
    if (state.showRotateConfirm) {
        AlertDialog(
            onDismissRequest = viewModel::dismissRotateConfirm,
            title = { Text("确认修改主密码？") },
            text = {
                Text(
                    "即将修改主密码：本机会用原主密码逐条解密、用新主密码重加密后整批提交。\n\n" +
                        SecurityViewModel.RELOGIN_CONFIRM_LINE + "\n\n确认继续？",
                )
            },
            confirmButton = {
                TextButton(onClick = viewModel::doRotate) { Text("确认") }
            },
            dismissButton = {
                TextButton(onClick = viewModel::dismissRotateConfirm) { Text("取消") }
            },
        )
    }

    // ── 导出前明文警告确认对话框 ──
    if (state.showExportConfirm) {
        AlertDialog(
            onDismissRequest = viewModel::dismissExportConfirm,
            title = { Text("确认导出备份？") },
            text = {
                Text("导出的是【明文】JSON 文件，包含全部密钥明文、接口地址等敏感信息。请妥善保管，导出后建议尽快删除。确认导出？")
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.prepareExport { items ->
                        if (items != null) exportLauncher.launch(viewModel.suggestedExportName())
                    }
                }) { Text("确认导出") }
            },
            dismissButton = {
                TextButton(onClick = viewModel::dismissExportConfirm) { Text("取消") }
            },
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurface,
    )
}

/** 安全面板全屏承载的包裹（带背景，便于从列表页覆盖显示）。 */
@Composable
fun SecurityPanelOverlay(onClose: () -> Unit, onDataChanged: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize()) {
        SecurityPanel(onClose = onClose, onDataChanged = onDataChanged)
    }
}
