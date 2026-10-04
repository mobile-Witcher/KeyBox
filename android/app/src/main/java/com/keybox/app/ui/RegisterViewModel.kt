package com.keybox.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.keybox.app.data.ServiceLocator
import com.keybox.core.crypto.KeyBoxCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 注册页状态（R01/R03 两步向导）。 */
data class RegisterUiState(
    val step: Int = 1,
    val phone: String = "",
    val code: String = "",
    val inviteCode: String = "",
    /** true=系统已有用户（必须填邀请码）；false=系统还没有用户（走首次初始化）。 */
    val needsInvite: Boolean = true,
    val password: String = "",
    val confirm: String = "",
    val sending: Boolean = false,
    val busy: Boolean = false,
    val countdown: Int = 0,
    val error: String? = null,
    val notice: String? = null,
)

/**
 * 注册 ViewModel（R01/R03）：
 *   第 1 步 手机号验证码登录（平台层，**未注册的号码也能登录**）→ 探针决定是否需要邀请码；
 *   第 2 步 生成主密钥材料并开户（kbRegister / kbInitAdmin）。
 *
 * 为什么必须先登录：kbRegister 的 uid 由云函数从平台会话注入，没有会话就没有身份可开户。
 * 安全边界：主密码与主密钥**绝不出设备**，只上传 kdf_salt 与 kdf_verifier。
 */
class RegisterViewModel(application: Application) : AndroidViewModel(application) {

    private val _uiState = MutableStateFlow(RegisterUiState())
    val uiState: StateFlow<RegisterUiState> = _uiState.asStateFlow()

    private var verificationId: String? = null
    private var countdownJob: Job? = null

    fun onPhoneChange(value: String) {
        _uiState.update { it.copy(phone = value, error = null) }
    }

    fun onCodeChange(value: String) {
        _uiState.update { it.copy(code = value, error = null) }
    }

    fun onInviteCodeChange(value: String) {
        _uiState.update { it.copy(inviteCode = value, error = null) }
    }

    fun onPasswordChange(value: String) {
        _uiState.update { it.copy(password = value, error = null) }
    }

    fun onConfirmChange(value: String) {
        _uiState.update { it.copy(confirm = value, error = null) }
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
                verificationId = ServiceLocator.authRepository.sendVerification(current.phone)
                _uiState.update { it.copy(notice = "验证码已发送，请查收短信") }
                startCountdown(RESEND_SECONDS)
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "发送验证码失败") }
            } finally {
                _uiState.update { it.copy(sending = false) }
            }
        }
    }

    /**
     * 第 1 步 → 第 2 步：验证码登录 + 门禁探针。
     * 已激活的账号直接回调 [onAlreadyActive]（不必再注册）。
     */
    fun verifyAndContinue(onAlreadyActive: (String) -> Unit) {
        val current = _uiState.value
        if (current.busy) return
        val id = verificationId
        if (id == null) {
            _uiState.update { it.copy(error = "请先获取验证码") }
            return
        }
        if (current.code.isBlank()) {
            _uiState.update { it.copy(error = "请输入验证码") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, error = null, notice = null) }
            try {
                val repository = ServiceLocator.authRepository
                val verificationToken = repository.verifyCode(id, current.code.trim())
                // 未注册号码必须走 signup（signin 会 404 User not exist）；
                // 若该号码其实已注册（平台报 exist），退回 signin 完成登录。
                val session = try {
                    repository.signUp(verificationToken, current.phone)
                } catch (e: Exception) {
                    if (e.message?.contains("exist", ignoreCase = true) == true) {
                        repository.signIn(verificationToken)
                    } else {
                        throw e
                    }
                }
                ServiceLocator.sessionStore.save(session)

                val probe = ServiceLocator.kbApi.probeActivation(session.accessToken)
                if (probe.activated) {
                    onAlreadyActive(session.uid)
                    return@launch
                }
                if (probe.status == "disabled") {
                    // 停用是管理员决定，不允许自助恢复
                    _uiState.update { it.copy(error = "该账号已被管理员停用，请联系管理员。") }
                    return@launch
                }

                // 注意：软删（deleted）账号允许重新开户（服务端 kbRegister 已按 status 分流）。
                _uiState.update {
                    it.copy(
                        step = 2,
                        needsInvite = probe.initialized,
                        notice = if (probe.initialized) {
                            "手机号验证成功，请填写邀请码并设置主密码。"
                        } else {
                            "系统尚无任何用户，你将成为首位管理员，请设置主密码。"
                        },
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "验证失败") }
            } finally {
                _uiState.update { it.copy(busy = false) }
            }
        }
    }

    /** 第 2 步：生成材料并开户（kbRegister / kbInitAdmin）。成功后回调 [onRegistered]。 */
    fun submit(onRegistered: (String) -> Unit) {
        val current = _uiState.value
        if (current.busy) return
        if (current.needsInvite && current.inviteCode.trim().isEmpty()) {
            _uiState.update { it.copy(error = "请填写邀请码") }
            return
        }
        if (current.password.length < 8) {
            _uiState.update { it.copy(error = "主密码至少 8 位") }
            return
        }
        if (current.password != current.confirm) {
            _uiState.update { it.copy(error = "两次输入的主密码不一致") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, error = null, notice = null) }
            try {
                val session = ServiceLocator.sessionStore.load()
                    ?: throw IllegalStateException("登录态缺失，请重新登录")
                val salt = KeyBoxCrypto.generateSaltB64()
                val raw = withContext(Dispatchers.Default) {
                    KeyBoxCrypto.deriveKey(current.password, salt)
                }
                val verifier = withContext(Dispatchers.Default) {
                    KeyBoxCrypto.encryptToKb1(raw, KeyBoxCrypto.VERIFIER_PLAINTEXT)
                }

                val env = if (current.needsInvite) {
                    ServiceLocator.kbApi.registerRemote(
                        current.inviteCode.trim(), salt, verifier, session.accessToken,
                    )
                } else {
                    ServiceLocator.kbApi.initAdminRemote(salt, verifier, session.accessToken)
                }

                if (!env.ok) {
                    _uiState.update { it.copy(error = describeError(env.error)) }
                    return@launch
                }

                _uiState.update { it.copy(notice = "注册成功，请用刚设置的主密码解锁。") }
                onRegistered(session.uid)
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "注册失败") }
            } finally {
                _uiState.update { it.copy(busy = false) }
            }
        }
    }

    /** 云函数错误码 → 用户可读文案（与网页版 / Windows / 鸿蒙口径一致）。 */
    private fun describeError(code: String): String = when (code) {
        "INVALID_CODE" -> "邀请码无效或已被使用，请向管理员索取新的邀请码"
        "LIMIT_REACHED" -> "已达 20 人开户上限，请联系管理员"
        "ALREADY_INITIALIZED" -> "系统已有用户，请改用邀请码激活"
        "ACCOUNT_DISABLED" -> "该账号已被管理员停用，请联系管理员"
        "MISSING_KDF_PARAMS" -> "主密码材料缺失，请重试"
        "MISSING_RECOVERY_PARAMS" -> "恢复码参数不完整，请重试"
        "" -> "注册失败，请稍后重试"
        else -> "注册失败：$code"
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
