package com.keybox.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel

/** 应用根组件：按会话/解锁状态切换 启动屏 / 登录页 / 解锁页 / 密钥列表（+安全面板覆盖层）。 */
@Composable
fun KeyBoxApp(viewModel: MainViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()

    Surface(modifier = Modifier.fillMaxSize()) {
        when (val current = state) {
            MainUiState.Loading -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            MainUiState.NeedsLogin -> LoginScreen(onLoginSuccess = viewModel::onLoginSuccess)

            is MainUiState.Locked -> UnlockScreen(
                onUnlocked = viewModel::onUnlocked,
                onLogout = viewModel::logout,
            )

            is MainUiState.Unlocked -> UnlockedArea(
                uid = current.uid,
                onLogout = viewModel::logout,
            )
        }
    }
}

/** 已解锁区域：密钥列表 + 安全面板覆盖层；安全面板的数据变更（改密码/导入）后触发列表重载。 */
@Composable
private fun UnlockedArea(uid: String, onLogout: () -> Unit) {
    var showSecurity by remember { mutableStateOf(false) }
    var dataVersion by remember { mutableIntStateOf(0) }

    VaultScreen(
        uid = uid,
        onLogout = onLogout,
        onOpenSecurity = { showSecurity = true },
        dataVersion = dataVersion,
    )

    if (showSecurity) {
        SecurityPanelOverlay(
            onClose = { showSecurity = false },
            onDataChanged = {
                dataVersion += 1
                showSecurity = false
            },
        )
    }
}
