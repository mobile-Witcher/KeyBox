package com.keybox.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.keybox.app.data.SKIN_DEFAULT_ID
import com.keybox.app.data.SKIN_DYNAMIC_ID
import com.keybox.app.data.ServiceLocator
import com.keybox.app.data.THEME_MODE_DARK
import com.keybox.app.data.THEME_MODE_LIGHT
import com.keybox.app.data.THEME_MODE_SYSTEM
import com.keybox.app.ui.theme.AppearanceActions
import com.keybox.app.ui.theme.KeyBoxSkin
import com.keybox.app.ui.theme.KeyBoxTheme
import com.keybox.app.ui.theme.LocalAppearance
import kotlinx.coroutines.launch

/**
 * 应用根组件（由 MainActivity 调用）：解析「皮肤 × 深浅」外观状态 → 应用主题
 * → 通过 [LocalAppearance] 把外观状态与动作提供给深层页面（顶栏入口 / 外观面板）。
 */
@Composable
fun KeyBoxRoot(viewModel: MainViewModel = viewModel()) {
    val store = ServiceLocator.themeStore
    val skinId by store.skinId.collectAsState(initial = SKIN_DEFAULT_ID)
    val themeMode by store.themeMode.collectAsState(initial = THEME_MODE_SYSTEM)
    val scope = rememberCoroutineScope()

    val systemDark = isSystemInDarkTheme()
    val darkTheme = when (themeMode) {
        THEME_MODE_LIGHT -> false
        THEME_MODE_DARK -> true
        else -> systemDark
    }
    val dynamic = skinId == SKIN_DYNAMIC_ID

    val appearance = remember(skinId, themeMode, darkTheme, dynamic) {
        AppearanceActions(
            isDark = darkTheme,
            skinId = skinId,
            themeMode = themeMode,
            onSelectSkin = { id -> scope.launch { store.setSkin(id) } },
            onSelectThemeMode = { mode -> scope.launch { store.setThemeMode(mode) } },
            onToggleDark = {
                scope.launch {
                    store.setThemeMode(if (darkTheme) THEME_MODE_LIGHT else THEME_MODE_DARK)
                }
            },
        )
    }

    CompositionLocalProvider(LocalAppearance provides appearance) {
        KeyBoxTheme(
            skin = KeyBoxSkin.fromId(skinId),
            darkTheme = darkTheme,
            dynamicColor = dynamic,
        ) {
            KeyBoxApp(viewModel)
        }
    }
}

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

/** 已解锁区域：密钥列表 + 安全/管理/外观覆盖层；数据变更后触发列表重载。 */
@Composable
private fun UnlockedArea(uid: String, onLogout: () -> Unit) {
    var showSecurity by remember { mutableStateOf(false) }
    var showAdmin by remember { mutableStateOf(false) }
    var showAppearance by remember { mutableStateOf(false) }
    var dataVersion by remember { mutableIntStateOf(0) }

    VaultScreen(
        uid = uid,
        onLogout = onLogout,
        onOpenSecurity = { showSecurity = true },
        onOpenAdmin = { showAdmin = true },
        onOpenAppearance = { showAppearance = true },
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

    if (showAdmin) {
        // 管理后台覆盖层（照 SecurityPanelOverlay 挂载模式）
        AdminScreenOverlay(
            onBack = { showAdmin = false },
            onLogout = onLogout,
        )
    }

    if (showAppearance) {
        // 外观选择覆盖层（B2）
        AppearancePanelOverlay(onClose = { showAppearance = false })
    }
}
