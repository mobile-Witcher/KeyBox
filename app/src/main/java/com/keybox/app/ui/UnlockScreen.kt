package com.keybox.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel

/**
 * 解锁页（照鸿蒙 Unlock.ets 三模式）：生物识别（优先）/ PIN / 主密码（兜底），
 * 首次主密码解锁成功后按设备能力引导设置快捷解锁（均可跳过）。
 */
@Composable
fun UnlockScreen(
    onUnlocked: () -> Unit,
    onLogout: () -> Unit,
    viewModel: UnlockViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    // BiometricPrompt 要求宿主为 FragmentActivity（MainActivity 已是）
    val activity = LocalContext.current as FragmentActivity

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
    ) {
        Text(
            text = "KeyBox 解锁",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onSurface,
        )

        Spacer(modifier = Modifier.height(24.dp))

        when (state.mode) {
            UnlockMode.LOADING -> Text(
                text = "加载中…",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            UnlockMode.BIO -> {
                Text(
                    text = "通过指纹 / 面容解锁",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = { viewModel.tryBio(activity, onUnlocked) },
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (state.busy) "认证中…" else "开始认证")
                }
                Spacer(modifier = Modifier.height(8.dp))
                ModeLink("使用 PIN 解锁 →") { viewModel.switchMode(UnlockMode.PIN) }
                ModeLink("使用主密码解锁 →") { viewModel.switchMode(UnlockMode.PASSWORD) }
            }

            UnlockMode.PIN -> {
                OutlinedTextField(
                    value = state.pin,
                    onValueChange = viewModel::onPinChange,
                    label = { Text("快捷 PIN（4-6 位数字）") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = { viewModel.tryPin(onUnlocked) },
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (state.busy) "校验中…" else "解锁")
                }
                Spacer(modifier = Modifier.height(8.dp))
                if (state.bioAvailable && state.hasBioLock) {
                    ModeLink("使用指纹 / 面容解锁 →") { viewModel.switchMode(UnlockMode.BIO) }
                }
                ModeLink("使用主密码解锁 →") {
                    viewModel.switchMode(UnlockMode.PASSWORD)
                }
            }

            UnlockMode.PASSWORD -> {
                OutlinedTextField(
                    value = state.masterPassword,
                    onValueChange = viewModel::onPasswordChange,
                    label = { Text("主密码") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = { viewModel.unlockWithPassword(onUnlocked) },
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (state.busy) "校验中…" else "解锁")
                }
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "主密码只在本机派生密钥，云端没有任何副本。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        state.status?.let { message ->
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        Spacer(modifier = Modifier.height(24.dp))
        TextButton(onClick = onLogout) {
            Text("退出登录")
        }
    }

    // ── 生物识别设置引导（主密码解锁成功后，设备支持时优先弹这个） ──
    if (state.showBioSetup) {
        AlertDialog(
            onDismissRequest = { viewModel.skipBioSetup(onUnlocked) },
            title = { Text("开启指纹 / 面容解锁") },
            text = {
                Column {
                    Text(
                        "主密钥将由设备安全芯片保护，之后打开 App 只需验证指纹或面容。安全性高于 PIN。",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    state.setupError?.let {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { viewModel.enableBiometric(activity, onUnlocked) }) {
                    Text("开启")
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.skipBioSetup(onUnlocked) }) {
                    Text("跳过")
                }
            },
        )
    }

    // ── PIN 设置对话框（设备不支持生物识别时的引导） ──
    if (state.showPinSetup) {
        AlertDialog(
            onDismissRequest = { viewModel.skipPinSetup(onUnlocked) },
            title = { Text("设置快捷 PIN") },
            text = {
                Column {
                    Text(
                        "之后打开 App 只需输入 PIN，不必再输主密码。连错 5 次 PIN 将被销毁。",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = state.pinNew,
                        onValueChange = viewModel::onPinNewChange,
                        label = { Text("PIN（4-6 位数字）") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = state.pinConfirm,
                        onValueChange = viewModel::onPinConfirmChange,
                        label = { Text("确认 PIN") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    state.setupError?.let {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { viewModel.savePinSetup(onUnlocked) }) {
                    Text("保存 PIN")
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.skipPinSetup(onUnlocked) }) {
                    Text("跳过")
                }
            },
        )
    }
}

@Composable
private fun ModeLink(text: String, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}
