package com.keybox.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.keybox.app.data.ServiceLocator
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** 登录页状态。 */
data class LoginUiState(
    val phone: String = "",
    val code: String = "",
    /** 发送验证码接口返回的 verification_id（内部持有，不进 UI）。 */
    val verificationId: String? = null,
    val sending: Boolean = false,
    val loggingIn: Boolean = false,
    /** 重新发送倒计时（秒），0 表示可发送。 */
    val countdown: Int = 0,
    val error: String? = null,
)

/**
 * 登录 ViewModel：发送验证码（60s 倒计时）→ 登录（verify + signIn）→ 持久化会话。
 */
class LoginViewModel(application: Application) : AndroidViewModel(application) {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    private var countdownJob: Job? = null

    fun onPhoneChange(value: String) {
        _uiState.update { it.copy(phone = value, error = null) }
    }

    fun onCodeChange(value: String) {
        _uiState.update { it.copy(code = value, error = null) }
    }

    fun sendCode() {
        val current = _uiState.value
        if (current.sending || current.countdown > 0) return
        if (current.phone.trim().isEmpty()) {
            _uiState.update { it.copy(error = "请输入手机号") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(sending = true, error = null) }
            try {
                val verificationId = ServiceLocator.authRepository.sendVerification(current.phone)
                _uiState.update { it.copy(verificationId = verificationId) }
                startCountdown(RESEND_SECONDS)
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "发送验证码失败") }
            } finally {
                _uiState.update { it.copy(sending = false) }
            }
        }
    }

    fun login(onSuccess: (String) -> Unit) {
        val current = _uiState.value
        if (current.loggingIn) return
        val verificationId = current.verificationId
        if (verificationId == null) {
            _uiState.update { it.copy(error = "请先获取验证码") }
            return
        }
        if (current.code.isBlank()) {
            _uiState.update { it.copy(error = "请输入验证码") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(loggingIn = true, error = null) }
            try {
                val repository = ServiceLocator.authRepository
                val verificationToken = repository.verifyCode(verificationId, current.code.trim())
                val session = repository.signIn(verificationToken)
                ServiceLocator.sessionStore.save(session)
                onSuccess(session.uid)
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "登录失败") }
            } finally {
                _uiState.update { it.copy(loggingIn = false) }
            }
        }
    }

    private fun startCountdown(seconds: Int) {
        countdownJob?.cancel()
        countdownJob = viewModelScope.launch {
            for (remaining in seconds downTo 1) {
                _uiState.update { it.copy(countdown = remaining) }
                delay(1_000L)
            }
            _uiState.update { it.copy(countdown = 0) }
        }
    }

    override fun onCleared() {
        countdownJob?.cancel()
    }

    private companion object {
        const val RESEND_SECONDS = 60
    }
}
