package com.keybox.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.keybox.app.data.AuthException
import com.keybox.app.data.BiometricLockStore
import com.keybox.app.data.MasterSession
import com.keybox.app.data.PinLockStore
import com.keybox.app.data.ServiceLocator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** 应用根状态（A2：登录 → 解锁 → 密钥列表 三段）。 */
sealed interface MainUiState {
    /** 启动中：正在读取/校验本地会话。 */
    data object Loading : MainUiState

    /** 未登录（或 refresh_token 已失效），展示登录页。 */
    data object NeedsLogin : MainUiState

    /** 已登录但未解锁 vault：展示三层解锁页（生物 / PIN / 主密码）。 */
    data class Locked(val uid: String) : MainUiState

    /** 已解锁：展示密钥列表。 */
    data class Unlocked(val uid: String) : MainUiState
}

/**
 * 应用根 ViewModel：会话恢复（重启免验证码）、解锁流转与登出。
 *
 * 恢复策略：本地有 refresh_token 即进入解锁页（masterKey 绝不持久化，重启必锁），
 * 同时静默续期校验——refresh_token 被服务器拒绝才回登录页；纯网络故障保持现状。
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
        _state.value = MainUiState.Locked(saved.uid)
        viewModelScope.launch {
            try {
                val fresh = ServiceLocator.authRepository.refreshSession(saved.refreshToken)
                store.save(fresh)
                if (_state.value is MainUiState.Locked) {
                    _state.value = MainUiState.Locked(fresh.uid.ifEmpty { saved.uid })
                }
            } catch (e: AuthException) {
                if (e.recoverableByRelogin) {
                    store.clear()
                    _state.value = MainUiState.NeedsLogin
                }
                // 非鉴权类失败（网络抖动/服务端 5xx）：保持解锁页，等数据请求时拦截器兜底
            } catch (e: Exception) {
                // 未知异常同样不打断本地登录态
            }
        }
    }

    fun onLoginSuccess(uid: String) {
        _state.value = MainUiState.Locked(uid)
    }

    fun onUnlocked() {
        val uid = ServiceLocator.sessionStore.load()?.uid.orEmpty()
        _state.value = MainUiState.Unlocked(uid)
    }

    /** 退出登录：清登录态 + 主密钥内存单例 + PIN/生物包裹物（全部本地痕迹）。 */
    fun logout() {
        ServiceLocator.sessionStore.clear()
        MasterSession.clear()
        val app = getApplication<Application>()
        viewModelScope.launch {
            PinLockStore(app).clearPinLock()
            BiometricLockStore(app).clear()
        }
        _state.value = MainUiState.NeedsLogin
    }
}
