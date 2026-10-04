package com.keybox.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.suspendCancellableCoroutine
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private val Context.bioDataStore by preferencesDataStore(name = "keybox_biometric")

/**
 * 生物识别解锁（指纹/面容）：AndroidKeyStore 硬件密钥 + 用户认证门禁
 * ——照鸿蒙 biometric.ets（HUKS 安全芯片密钥）的架构语义移植。
 *
 * 架构：设置时在 TEE/安全芯片生成一把 AES-256 密钥，标记「使用时需生物认证」且不可导出；
 *       用它加密主密钥 → 密文与 IV 存 DataStore。
 *       解锁时初始化解密 Cipher 绑定进 BiometricPrompt.CryptoObject →
 *       系统弹认证 UI → 通过后 Cipher 才可 doFinal → 解出主密钥进内存。
 *
 * 降级：无硬件/未录入指纹（canAuthenticate != SUCCESS）时自动回退 PIN/主密码。
 */
class BiometricLockStore(private val context: Context) {

    private val keystore: KeyStore =
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    /** 设备是否可用生物认证（有硬件且已录入；CryptoObject 门禁密钥要求 Class 3/STRONG）。 */
    fun isAvailable(): Boolean = BiometricManager.from(context)
        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
        BiometricManager.BIOMETRIC_SUCCESS

    /** 是否已设置生物识别解锁（有密文存档）。 */
    suspend fun hasLock(): Boolean = context.bioDataStore.data.first()[BIO_ENC]
        .orEmpty()
        .isNotEmpty()

    /** 清除生物识别解锁（退出登录/手动关闭）：删存档 + 删芯片密钥。 */
    suspend fun clear() {
        context.bioDataStore.edit { it.clear() }
        runCatching { keystore.deleteEntry(BIO_KEY_ALIAS) } // 密钥不存在时忽略
    }

    /**
     * 设置生物识别解锁：生成认证门禁密钥并加密主密钥（过程中弹系统认证）。
     * 认证取消/未通过/硬件错误都会抛异常，调用方提示后仍可走 PIN/主密码。
     */
    suspend fun setup(activity: FragmentActivity, masterKeyRaw: ByteArray) {
        check(isAvailable()) { "设备不支持生物识别或未录入指纹" }
        // 已存在则先删除重建（用户可能重新录入指纹）
        keystore.deleteEntry(BIO_KEY_ALIAS)
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE,
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                BIO_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .build(),
        )
        generator.generateKey()

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getKeystoreKey())
        val iv = cipher.iv
        // 弹系统认证：CryptoObject 绑定加密 Cipher，认证通过才允许 doFinal
        val encrypted = authenticate(activity, cipher, "验证指纹以开启生物识别解锁") {
            it.cryptoObject?.cipher?.doFinal(masterKeyRaw)
        }
        context.bioDataStore.edit {
            it[BIO_ENC] = Base64.getEncoder().encodeToString(encrypted)
            it[BIO_IV] = Base64.getEncoder().encodeToString(iv)
        }
    }

    /** 生物识别解锁：返回主密钥原始字节；无存档返回 null；取消/未通过抛异常。 */
    suspend fun unlock(activity: FragmentActivity): ByteArray? {
        val prefs = context.bioDataStore.data.first()
        val encB64 = prefs[BIO_ENC] ?: return null
        val ivB64 = prefs[BIO_IV] ?: return null
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            getKeystoreKey(),
            GCMParameterSpec(GCM_TAG_BITS, Base64.getDecoder().decode(ivB64)),
        )
        val plain = authenticate(activity, cipher, "验证指纹以解锁 KeyBox") {
            it.cryptoObject?.cipher?.doFinal(Base64.getDecoder().decode(encB64))
        }
        check(plain.size == 32) { "解密结果异常" }
        return plain
    }

    private fun getKeystoreKey() = keystore.getKey(BIO_KEY_ALIAS, null) as javax.crypto.SecretKey

    /**
     * 弹系统认证 UI 并执行绑定 Cipher 的加/解密，返回运算结果。
     * 用户取消（负按钮/ dismiss）按错误处理抛出——上层保持当前模式可重试或切换。
     */
    private suspend fun authenticate(
        activity: FragmentActivity,
        cipher: Cipher,
        subtitle: String,
        cryptoOp: (BiometricPrompt.AuthenticationResult) -> ByteArray?,
    ): ByteArray = suspendCancellableCoroutine { cont ->
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    try {
                        val out = cryptoOp(result)
                        if (out == null) {
                            cont.resumeWithException(AuthException("认证通过但加解密失败"))
                        } else {
                            cont.resume(out)
                        }
                    } catch (e: Exception) {
                        cont.resumeWithException(AuthException("加解密失败：${e.message}"))
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    cont.resumeWithException(AuthException("生物识别未通过：$errString"))
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("KeyBox 解锁")
            .setSubtitle(subtitle)
            .setNegativeButtonText("取消")
            .build()
        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val BIO_KEY_ALIAS = "keybox-bio-key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
        val BIO_ENC = stringPreferencesKey("master_enc")
        val BIO_IV = stringPreferencesKey("master_iv")
    }
}
