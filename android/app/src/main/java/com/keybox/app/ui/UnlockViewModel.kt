package com.keybox.app.ui

import android.app.Application
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.keybox.app.data.AuthException
import com.keybox.app.data.BiometricLockStore
import com.keybox.app.data.MasterSession
import com.keybox.app.data.PinLockStore
import com.keybox.app.data.ServiceLocator
import com.keybox.core.crypto.KeyBoxCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 解锁页模式（照鸿蒙 Unlock.ets：生物识别优先 → PIN → 主密码兜底）。 */
enum class UnlockMode { LOADING, BIO, PIN, PASSWORD }

/** 解锁页状态。 */
data class UnlockUiState(
    val mode: UnlockMode = UnlockMode.LOADING,
    val busy: Boolean = false,
    val status: String? = null,
    val pin: String = "",
    val masterPassword: String = "",
    val pinFails: Int = 0,
    val hasBioLock: Boolean = false,
    val bioAvailable: Boolean = false,
    val showBioSetup: Boolean = false,
    val showPinSetup: Boolean = false,
    val pinNew: String = "",
    val pinConfirm: String = "",
    val setupError: String? = null,
)

/**
 * 三层解锁 ViewModel（照鸿蒙 Unlock.ets 语义）：
 *   1. 主密码：fetchMyKeyInfo → deriveKey → 解 kdf_verifier == "KeyBox-Verify" → masterKey 进内存单例；
 *      成功后按设备能力引导快捷解锁（生物优先，不支持则 PIN，均可跳过）。
 *   2. PIN：解 PIN 包裹物出 masterKey；连错 5 次销毁包裹物回退主密码。
 *   3. 生物识别：AndroidKeyStore 门禁密钥 + BiometricPrompt 解包裹物；不可用自动降级。
 */
class UnlockViewModel(application: Application) : AndroidViewModel(application) {

    private val pinStore = PinLockStore(application)
    private val bioStore = BiometricLockStore(application)

    private val _uiState = MutableStateFlow(UnlockUiState())
    val uiState: StateFlow<UnlockUiState> = _uiState.asStateFlow()

    init {
        initMode()
    }

    fun onPasswordChange(value: String) {
        _uiState.update { it.copy(masterPassword = value, status = null) }
    }

    fun onPinChange(value: String) {
        _uiState.update { it.copy(pin = value.filter { c -> c.isDigit() }.take(6), status = null) }
    }

    fun onPinNewChange(value: String) {
        _uiState.update { it.copy(pinNew = value.filter { c -> c.isDigit() }.take(6), setupError = null) }
    }

    fun onPinConfirmChange(value: String) {
        _uiState.update { it.copy(pinConfirm = value.filter { c -> c.isDigit() }.take(6), setupError = null) }
    }

    /** 模式选择：有生物识别包裹物且设备支持 → bio；否则有 PIN 包裹物 → pin；否则主密码。 */
    private fun initMode() {
        viewModelScope.launch {
            val hasBioLock = runCatching { bioStore.hasLock() }.getOrDefault(false)
            val bioAvailable = runCatching { bioStore.isAvailable() }.getOrDefault(false)
            val hasPin = runCatching { pinStore.hasPinLock() }.getOrDefault(false)
            _uiState.update {
                it.copy(
                    hasBioLock = hasBioLock,
                    bioAvailable = bioAvailable,
                    mode = when {
                        hasBioLock && bioAvailable -> UnlockMode.BIO
                        hasPin -> UnlockMode.PIN
                        else -> UnlockMode.PASSWORD
                    },
                )
            }
        }
    }

    // ── 生物识别解锁 ──

    fun tryBio(activity: FragmentActivity, onSuccess: () -> Unit) {
        val current = _uiState.value
        if (current.busy) return
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, status = null) }
            try {
                val raw = bioStore.unlock(activity)
                if (raw == null) {
                    _uiState.update { it.copy(busy = false, status = "尚未设置生物识别解锁") }
                    return@launch
                }
                adoptMasterKey(raw)
                _uiState.update { it.copy(busy = false, status = null) }
                onSuccess()
            } catch (e: Exception) {
                // 取消/未通过/硬件错误
                _uiState.update { it.copy(busy = false, status = e.message ?: "生物识别未通过") }
            }
        }
    }

    fun switchMode(mode: UnlockMode) {
        _uiState.update { it.copy(mode = mode, status = null) }
    }

    // ── PIN 解锁 ──

    fun tryPin(onSuccess: () -> Unit) {
        val current = _uiState.value
        if (current.busy) return
        if (!current.pin.matches(PIN_PATTERN)) {
            _uiState.update { it.copy(status = "PIN 为 4-6 位数字") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, status = null) }
            val raw = pinStore.unlockWithPin(current.pin)
            if (raw == null) {
                val fails = current.pinFails + 1
                _uiState.update { it.copy(pin = "") }
                if (fails >= PIN_MAX_FAILS) {
                    pinStore.clearPinLock()
                    _uiState.update {
                        it.copy(
                            busy = false,
                            pinFails = 0,
                            mode = UnlockMode.PASSWORD,
                            status = "PIN 连错 $PIN_MAX_FAILS 次，已销毁快捷解锁，请用主密码解锁",
                        )
                    }
                } else {
                    _uiState.update {
                        it.copy(busy = false, pinFails = fails, status = "PIN 不正确（剩余 ${PIN_MAX_FAILS - fails} 次机会）")
                    }
                }
                return@launch
            }
            adoptMasterKey(raw)
            _uiState.update { it.copy(busy = false, status = null) }
            onSuccess()
        }
    }

    // ── 主密码解锁（根防线） ──

    fun unlockWithPassword(onSuccess: () -> Unit) {
        val current = _uiState.value
        if (current.busy) return
        if (current.masterPassword.isEmpty()) {
            _uiState.update { it.copy(status = "请输入主密码") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, status = "正在校验主密码…") }
            try {
                val session = ServiceLocator.sessionStore.load()
                    ?: throw AuthException("登录态缺失，请重新登录")
                val info = ServiceLocator.kbApi.fetchMyKeyInfo(session.uid, session.accessToken)
                if (info.status != "active") {
                    throw AuthException("账号已被停用")
                }
                val raw = withContext(Dispatchers.Default) {
                    KeyBoxCrypto.deriveKey(current.masterPassword, info.kdfSalt)
                }
                // 解对了没的判据：kdf_verifier 能解出固定串即正确（失败提示不暴露具体原因）
                val verifierOk = try {
                    KeyBoxCrypto.decryptFromKb1(raw, info.kdfVerifier) == KeyBoxCrypto.VERIFIER_PLAINTEXT
                } catch (_: Exception) {
                    false
                }
                if (!verifierOk) {
                    _uiState.update { it.copy(busy = false, status = "主密码不正确。") }
                    return@launch
                }
                MasterSession.setMasterKey(raw, info.keyEpoch)
                ServiceLocator.sessionStore.saveKeyEpoch(info.keyEpoch)
                proceedToSetup()
                _uiState.value.let { if (!it.showBioSetup && !it.showPinSetup) onSuccess() }
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, status = "解锁失败：${e.message}") }
            }
        }
    }

    /** 按设备能力引导设置快捷解锁：生物识别优先，不支持则 PIN，均可跳过（照鸿蒙）。 */
    private suspend fun proceedToSetup() {
        val hasPin = runCatching { pinStore.hasPinLock() }.getOrDefault(false)
        _uiState.update {
            when {
                !it.hasBioLock && it.bioAvailable -> it.copy(busy = false, showBioSetup = true, status = null)
                !hasPin -> it.copy(busy = false, showPinSetup = true, status = null)
                else -> it.copy(busy = false, status = null)
            }
        }
    }

    // ── 快捷解锁设置引导 ──

    /** 开启生物识别（弹系统认证并保存主密钥密文），成功即进入列表。 */
    fun enableBiometric(activity: FragmentActivity, onDone: () -> Unit) {
        val raw = MasterSession.masterKeyRaw()
        if (raw == null) {
            _uiState.update { it.copy(setupError = "主密钥不在内存，请重新解锁") }
            return
        }
        viewModelScope.launch {
            try {
                bioStore.setup(activity, raw)
                _uiState.update { it.copy(hasBioLock = true, bioAvailable = true, showBioSetup = false, setupError = null) }
                onDone()
            } catch (e: Exception) {
                _uiState.update { it.copy(setupError = e.message ?: "开启失败") }
            }
        }
    }

    /** 跳过生物识别 → 生物不可用/跳过时转 PIN 引导。 */
    fun skipBioSetup(onDone: () -> Unit) {
        viewModelScope.launch {
            val hasPin = runCatching { pinStore.hasPinLock() }.getOrDefault(false)
            _uiState.update {
                if (hasPin) it.copy(showBioSetup = false, setupError = null) else it.copy(showBioSetup = false, showPinSetup = true, setupError = null)
            }
            if (hasPin) onDone()
        }
    }

    /** 保存 PIN 并进入列表。 */
    fun savePinSetup(onDone: () -> Unit) {
        val current = _uiState.value
        if (!current.pinNew.matches(PIN_PATTERN)) {
            _uiState.update { it.copy(setupError = "PIN 必须是 4-6 位数字") }
            return
        }
        if (current.pinNew != current.pinConfirm) {
            _uiState.update { it.copy(setupError = "两次输入的 PIN 不一致") }
            return
        }
        val raw = MasterSession.masterKeyRaw()
        if (raw == null) {
            _uiState.update { it.copy(setupError = "主密钥不在内存，请重新解锁") }
            return
        }
        viewModelScope.launch {
            try {
                pinStore.savePinLock(current.pinNew, raw)
                _uiState.update { it.copy(showPinSetup = false, pinNew = "", pinConfirm = "", setupError = null) }
                onDone()
            } catch (e: Exception) {
                _uiState.update { it.copy(setupError = e.message ?: "保存 PIN 失败") }
            }
        }
    }

    fun skipPinSetup(onDone: () -> Unit) {
        _uiState.update { it.copy(showPinSetup = false, pinNew = "", pinConfirm = "", setupError = null) }
        onDone()
    }

    /** 生物/PIN 解包成功：masterKey 进内存；代数取自持久化元数据（重启后仍可做代数比对）。 */
    private fun adoptMasterKey(raw: ByteArray) {
        val epoch = ServiceLocator.sessionStore.loadKeyEpoch()
        MasterSession.setMasterKey(raw, epoch)
    }

    private companion object {
        const val PIN_MAX_FAILS = 5
        val PIN_PATTERN = Regex("^\\d{4,6}$")
    }
}
