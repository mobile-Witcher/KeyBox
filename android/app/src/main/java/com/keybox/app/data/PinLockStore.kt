package com.keybox.app.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.keybox.core.crypto.KeyBoxCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.util.Base64

private val Context.pinDataStore by preferencesDataStore(name = "keybox_pin")

/**
 * PIN 快捷解锁（主密钥的本地加密保管）——照鸿蒙 pinlock.ets 语义移植。
 *
 * 原理：首次主密码解锁成功后，可用自设 PIN（4-6 位）把主密钥加密存本机：
 *   pin --PBKDF2(100k, 盐)--> 32B 密钥 --AES-256-GCM--> 主密钥包裹物（KB1: 格式）
 * 之后打开 App 只需输 PIN 解出主密钥，不必再输长主密码。
 *
 * 安全模型（如实告知用户）：
 *   - PIN 包只存应用私有目录（DataStore），其他应用不可读；
 *   - 设备丢失 + PIN 被猜中的风险由「错误 5 次自动销毁 PIN 包」缓解（UnlockViewModel）；
 *   - 主密码永远是最后防线：PIN 包被销毁/不可用时回退主密码解锁。
 */
class PinLockStore(private val context: Context) {

    /** 是否已设置 PIN 解锁（有包裹物存档）。 */
    suspend fun hasPinLock(): Boolean = read()[PIN_BLOB]
        .orEmpty()
        .startsWith("KB1:")

    /** 保存 PIN 加密的主密钥包裹物（主密码解锁成功后调用）。 */
    suspend fun savePinLock(pin: String, masterKeyRaw: ByteArray) {
        require(pin.matches(PIN_PATTERN)) { "PIN 必须是 4-6 位数字" }
        val saltB64 = KeyBoxCrypto.generateSaltB64()
        withContext(Dispatchers.Default) {
            // 与主密钥同规范但独立轮数（100k）；盐与密文一起落盘（解封时要用盐重派生 PIN 密钥）
            val pinKey = KeyBoxCrypto.deriveKey(pin, saltB64, KeyBoxCrypto.PIN_ITERATIONS)
            // 主密钥原始字节 → base64 → 作为明文用 PIN 密钥加密（KB1 结构，与鸿蒙一致）
            val masterB64 = Base64.getEncoder().encodeToString(masterKeyRaw)
            val enc = KeyBoxCrypto.encryptToKb1(pinKey, masterB64)
            context.pinDataStore.edit {
                it[PIN_BLOB] = enc
                it[PIN_SALT] = saltB64
            }
        }
    }

    /** 用 PIN 解出主密钥；错误返回 null（密码错/包损坏）。 */
    suspend fun unlockWithPin(pin: String): ByteArray? {
        val prefs = read()
        val enc = prefs[PIN_BLOB] ?: return null
        val saltB64 = prefs[PIN_SALT] ?: return null
        return withContext(Dispatchers.Default) {
            try {
                val pinKey = KeyBoxCrypto.deriveKey(pin, saltB64, KeyBoxCrypto.PIN_ITERATIONS)
                val masterB64 = KeyBoxCrypto.decryptFromKb1(pinKey, enc)
                val raw = Base64.getDecoder().decode(masterB64)
                if (raw.size != 32) null else raw
            } catch (_: Exception) {
                null
            }
        }
    }

    /** 清除 PIN 包（连错 5 次 / 退出登录）。 */
    suspend fun clearPinLock() {
        context.pinDataStore.edit { it.clear() }
    }

    private suspend fun read(): Preferences = context.pinDataStore.data.first()

    private companion object {
        val PIN_BLOB = stringPreferencesKey("pin_blob")
        val PIN_SALT = stringPreferencesKey("pin_salt")
        val PIN_PATTERN = Regex("^\\d{4,6}$")
    }
}
