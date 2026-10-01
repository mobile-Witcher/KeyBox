package com.keybox.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel

/** 应用根组件：按会话状态切换 启动屏 / 登录页 / 主界面。 */
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

            is MainUiState.LoggedIn -> HomeScreen(
                uid = current.uid,
                onLogout = viewModel::logout,
            )
        }
    }
}
