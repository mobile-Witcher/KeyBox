package com.keybox.app.ui

import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import android.app.Application
import com.keybox.app.data.AuthException
import com.keybox.app.data.ServiceLocator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** 应用根状态。 */
sealed interface MainUiState {
    /** 启动中：正在读取/校验本地会话。 */
    data object Loading : MainUiState

    /** 未登录（或 refresh_token 已失效），展示登录页。 */
    data object NeedsLogin : MainUiState

    /** 已登录。 */
    data class LoggedIn(val uid: String) : MainUiState
}

/**
 * 应用根 ViewModel：负责会话恢复（重启免验证码）与登出。
 * 恢复策略：本地有 refresh_token 即乐观进入主页，同时静默续期校验——
 * refresh_token 被服务器拒绝才回登录页；纯网络故障保持本地登录态。
 */
class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val _state = MutableStateFlow<MainUiState>(MainUiState.Loading)
    val state: StateFlow<MainUiState> = _state.asStateFlow()

    init {
        restoreSession()
    }

    fun restoreSession() {
        val store = ServiceLocator.sessionStore
        val saved = store.load()
        if (saved == null) {
            _state.value = MainUiState.NeedsLogin
            return
        }
        _state.value = MainUiState.LoggedIn(saved.uid)
        viewModelScope.launch {
            try {
                val fresh = ServiceLocator.authRepository.refreshSession(saved.refreshToken)
                store.save(fresh)
                _state.value = MainUiState.LoggedIn(fresh.uid.ifEmpty { saved.uid })
            } catch (e: AuthException) {
                if (e.recoverableByRelogin) {
                    store.clear()
                    _state.value = MainUiState.NeedsLogin
                }
                // 非鉴权类失败（网络抖动/服务端 5xx）：保持本地登录态，等下次数据请求时拦截器兜底
            } catch (e: Exception) {
                // 未知异常同样不打断本地登录态
            }
        }
    }

    fun onLoginSuccess(uid: String) {
        _state.value = MainUiState.LoggedIn(uid)
    }

    fun logout() {
        ServiceLocator.sessionStore.clear()
        _state.value = MainUiState.NeedsLogin
    }
}
