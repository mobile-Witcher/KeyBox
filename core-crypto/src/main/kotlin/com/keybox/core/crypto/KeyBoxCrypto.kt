/**
 * KeyBoxCrypto —— KeyBox 加密层（纯 JVM，javax.crypto 标准库，禁止自研算法）。
 *
 * 算法规范（与 Web 端 src/lib/crypto.ts 及 harmonyInterop.test.ts 固化向量逐字节一致，
 * 任何一侧改动参数都必须三端同步并通过向量测试）：
 *
 *   派生：PBKDF2-HMAC-SHA256（JCE 名：PBKDF2WithHmacSHA256），
 *         600000 轮，16 字节随机盐（base64 存储），输出 32 字节
 *   加密：AES-256-GCM，12 字节随机 IV，128 位 GCM 认证标签
 *   密文：`KB1:` + base64( IV(12B) ‖ 密文 ‖ GCM 标签(16B) )
 *
 * 说明：javax.crypto 的 AES/GCM/NoPadding 在加密时 doFinal 输出即为「密文‖标签」，
 * 与 WebCrypto 的输出布局一致，因此拼接 IV 后整体 base64 即与 Web 端同构。
 */
package com.keybox.core.crypto

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

object KeyBoxCrypto {

    /** 生产迭代次数（架构 §6，与 Web crypto.ts 的 PBKDF2_ITERATIONS 一致）。 */
    const val PBKDF2_ITERATIONS = 600_000

    /** 迭代次数下限（为流畅降速也不得低于此值，与 Web PBKDF2_ITERATIONS_MIN 一致）。 */
    const val PBKDF2_ITERATIONS_MIN = 210_000

    /**
     * PIN 快捷解锁的派生轮数（与鸿蒙 pinlock.ets 的 PIN_ITERATIONS 一致）。
     * 与主密钥同规范但独立轮数：PIN 组合少，靠轮数慢化本地爆破。
     */
    const val PIN_ITERATIONS = 100_000

    /** 密文前缀（与 Web SECRET_PREFIX 一致）。 */
    const val SECRET_PREFIX = "KB1:"

    /** R28 恢复码包裹前缀（与 Web crypto.ts RECOVERY_PREFIX / 鸿蒙 kbrecovery.ets 一致）。 */
    const val RECOVERY_PREFIX = "KBRC1:"

    /** 主密钥校验用的固定串：它不是密钥，只是"解对了没"的判据。 */
    const val VERIFIER_PLAINTEXT = "KeyBox-Verify"

    private const val SALT_BYTES = 16
    private const val IV_BYTES = 12
    private const val KEY_BITS = 256
    private const val TAG_BITS = 128

    /** IV + 至少 16 字节 GCM 标签，短于此视为被截断。 */
    private const val MIN_BOXED_BYTES = IV_BYTES + 16

    private val random = SecureRandom()

    /** 生成 16 字节密码学随机盐并返回 base64（存 kb_users.kdf_salt）。 */
    fun generateSaltB64(): String {
        val salt = ByteArray(SALT_BYTES)
        random.nextBytes(salt)
        return Base64.getEncoder().encodeToString(salt)
    }

    /**
     * PBKDF2-HMAC-SHA256 派生：把密码 + base64 盐派生成 32 字节原始密钥。
     *
     * @param password   用户主密码（UTF-8 编码后参与派生，与 Web TextEncoder 行为一致）
     * @param saltB64    16 字节盐的 base64 形态
     * @param iterations 迭代次数，须为正整数
     * @return 32 字节原始密钥
     */
    fun deriveKey(
        password: String,
        saltB64: String,
        iterations: Int = PBKDF2_ITERATIONS,
    ): ByteArray {
        require(password.isNotEmpty()) { "主密码不能为空" }
        require(iterations >= 1) { "迭代次数必须为正整数" }
        val salt = Base64.getDecoder().decode(saltB64)
        val spec = PBEKeySpec(password.toCharArray(), salt, iterations, KEY_BITS)
        val key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(spec)
            .encoded
        spec.clearPassword()
        return key
    }

    /** 由 32 字节原始密钥构造 AES 密钥对象。 */
    fun keyFromRaw(raw: ByteArray): SecretKey = SecretKeySpec(raw, "AES")

    /**
     * 把明文字符串加密成 `KB1:` 串（IV(12B) ‖ 密文 ‖ 标签(16B)，整体 base64）。
     */
    fun encryptToKb1(key: SecretKey, plaintext: String): String {
        val iv = ByteArray(IV_BYTES).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        val ctWithTag = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val boxed = ByteArray(iv.size + ctWithTag.size)
        iv.copyInto(boxed, 0)
        ctWithTag.copyInto(boxed, iv.size)
        return SECRET_PREFIX + Base64.getEncoder().encodeToString(boxed)
    }

    /** [encryptToKb1] 的原始字节数钥便捷重载。 */
    fun encryptToKb1(rawKey: ByteArray, plaintext: String): String =
        encryptToKb1(keyFromRaw(rawKey), plaintext)

    /**
     * 解开 `KB1:` 串；前缀不对、密文被截断或被篡改（GCM 校验失败）都会抛异常。
     */
    fun decryptFromKb1(key: SecretKey, kb1: String): String {
        require(kb1.startsWith(SECRET_PREFIX)) { "密文前缀不是 $SECRET_PREFIX" }
        val boxed = Base64.getDecoder().decode(kb1.substring(SECRET_PREFIX.length))
        if (boxed.size < MIN_BOXED_BYTES) {
            throw IllegalArgumentException("密文长度不足，疑似被截断")
        }
        val iv = boxed.copyOfRange(0, IV_BYTES)
        val ctWithTag = boxed.copyOfRange(IV_BYTES, boxed.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        val plain = cipher.doFinal(ctWithTag)
        return String(plain, Charsets.UTF_8)
    }

    /** [decryptFromKb1] 的原始字节数钥便捷重载。 */
    fun decryptFromKb1(rawKey: ByteArray, kb1: String): String =
        decryptFromKb1(keyFromRaw(rawKey), kb1)

    /** 生成 kdf_verifier：用主密钥加密固定串（不含任何真实密钥）。 */
    fun createKeyVerifier(key: SecretKey): String = encryptToKb1(key, VERIFIER_PLAINTEXT)

    /**
     * 本机校验主密码是否正确：解 kdf_verifier 能解出固定串即正确。
     * 失败一律返回 false，不抛出细节，避免把"为什么失败"暴露给日志。
     */
    fun verifyMasterPassword(
        password: String,
        saltB64: String,
        verifier: String,
        iterations: Int = PBKDF2_ITERATIONS,
    ): Boolean = try {
        val key = keyFromRaw(deriveKey(password, saltB64, iterations))
        decryptFromKb1(key, verifier) == VERIFIER_PLAINTEXT
    } catch (_: Exception) {
        false
    }

    /** 字节数组转小写 hex（测试断言用）。 */
    fun bytesToHex(bytes: ByteArray): String = bytes.joinToString(separator = "") { byte ->
        "%02x".format(byte.toInt() and 0xff)
    }

    // -------------------------------------------------------------------------
    // R28 恢复码原语（纯新增，与 Web crypto.ts / 鸿蒙 kbrecovery.ets 字节级对齐）
    //
    //   恢复码：32 字符标准 base32（无易混字符），分组展示为 XXXX-XXXX-…
    //   派生：RK = PBKDF2-HMAC-SHA256(normalize(恢复码), recovery_salt, 600000, 32B)
    //         —— 复用 deriveKey（与主密钥同一派生原语、同参数）
    //   包裹：`KBRC1:` + base64( IV(12B) ‖ AES-256-GCM(RK, masterKeyRaw) ‖ GCM tag(16B) )
    //   recovery_salt 必须独立于 kdf_salt（入口强校验）
    //
    //   既有 deriveKey/encryptToKb1/decryptFromKb1 的算法参数与实现零改动。
    // -------------------------------------------------------------------------

    /** RFC 4648 标准 base32 字母表（与 Web BASE32_ALPHABET 一致）。 */
    private const val BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    private const val RECOVERY_CODE_LENGTH = 32
    private const val RECOVERY_GROUP_SIZE = 4

    /** 生成恢复码原始串（32 字符、无分隔；拒绝采样保证无偏）。 */
    fun generateRecoveryCodeRaw(): String = randomBase32(RECOVERY_CODE_LENGTH)

    /** 把恢复码按 4 字符一组分组（XXXX-XXXX-…），便于抄写。 */
    fun formatRecoveryCode(rawCode: String): String {
        val normalized = normalizeRecoveryCode(rawCode)
        val groups = ArrayList<String>()
        var i = 0
        while (i < normalized.length) {
            groups.add(normalized.substring(i, minOf(i + RECOVERY_GROUP_SIZE, normalized.length)))
            i += RECOVERY_GROUP_SIZE
        }
        return groups.joinToString("-")
    }

    /** 规整用户输入的恢复码：去分隔符与空格、转大写，只保留 base32 字符。 */
    fun normalizeRecoveryCode(input: String): String {
        val upper = input.uppercase()
        val out = StringBuilder(upper.length)
        for (ch in upper) {
            if (BASE32_ALPHABET.indexOf(ch) >= 0) out.append(ch)
        }
        return out.toString()
    }

    /** 由恢复码 + 独立 recovery_salt 派生恢复密钥 RK（32 字节）。 */
    fun deriveRecoveryKeyRaw(
        recoveryCode: String,
        recoverySaltB64: String,
        iterations: Int = PBKDF2_ITERATIONS,
    ): ByteArray {
        val code = normalizeRecoveryCode(recoveryCode)
        require(code.length == RECOVERY_CODE_LENGTH) { "恢复码长度必须为 32 个 base32 字符" }
        return deriveKey(code, recoverySaltB64, iterations)
    }

    /**
     * 用恢复码把主密钥（原始 32 字节）包裹成 `KBRC1:` 串。
     * 入口强校验 recovery_salt 独立于 kdf_salt（与 Web/鸿蒙一致，不得复用主密码派生盐）。
     */
    fun wrapMasterKeyWithRecovery(
        recoveryCode: String,
        recoverySaltB64: String,
        kdfSaltB64: String,
        masterKeyRaw: ByteArray,
        iterations: Int = PBKDF2_ITERATIONS,
    ): String {
        require(recoverySaltB64 != kdfSaltB64) {
            "recovery_salt 必须独立于 kdf_salt（不得复用主密码派生盐）"
        }
        val rk = deriveRecoveryKeyRaw(recoveryCode, recoverySaltB64, iterations)
        val boxed = sealGcm(keyFromRaw(rk), masterKeyRaw)
        return RECOVERY_PREFIX + Base64.getEncoder().encodeToString(boxed)
    }

    /**
     * 反向流程：用恢复码解开 `KBRC1:` 串，取回主密钥原始字节（32 字节）。
     * 恢复码输错或密文被改都会抛异常（GCM 校验）。
     */
    fun unwrapMasterKeyWithRecovery(
        recoveryCode: String,
        recoverySaltB64: String,
        recoveryBlob: String,
        iterations: Int = PBKDF2_ITERATIONS,
    ): ByteArray {
        require(recoveryBlob.startsWith(RECOVERY_PREFIX)) {
            "恢复码密文前缀不是 $RECOVERY_PREFIX"
        }
        val rk = deriveRecoveryKeyRaw(recoveryCode, recoverySaltB64, iterations)
        val boxed = Base64.getDecoder().decode(recoveryBlob.substring(RECOVERY_PREFIX.length))
        if (boxed.size < IV_BYTES + 16) throw IllegalArgumentException("恢复码密文长度不足")
        val plain = openGcm(keyFromRaw(rk), boxed)
        if (plain.size != KEY_BITS / 8) throw IllegalArgumentException("解回的主密钥长度非法")
        return plain
    }

    /** 生成无偏 base32 随机串（256 是 32 的整数倍，天然无偏；护栏保留）。 */
    private fun randomBase32(length: Int): String {
        val alphabetLen = BASE32_ALPHABET.length
        val maxUnbiased = 256 - (256 % alphabetLen)
        val out = StringBuilder(length)
        while (out.length < length) {
            val buf = ByteArray(length - out.length + 8).also { random.nextBytes(it) }
            for (b in buf) {
                if (out.length >= length) break
                if ((b.toInt() and 0xff) < maxUnbiased) {
                    out.append(BASE32_ALPHABET[(b.toInt() and 0xff) % alphabetLen])
                }
            }
        }
        return out.toString()
    }

    /** AES-256-GCM 封装：返回 IV(12B) ‖ 密文 ‖ 标签(16B)。 */
    private fun sealGcm(key: SecretKey, plaintext: ByteArray): ByteArray {
        val iv = ByteArray(IV_BYTES).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        val ctWithTag = cipher.doFinal(plaintext)
        val boxed = ByteArray(iv.size + ctWithTag.size)
        iv.copyInto(boxed, 0)
        ctWithTag.copyInto(boxed, iv.size)
        return boxed
    }

    /** AES-256-GCM 解封：入参 IV(12B) ‖ 密文 ‖ 标签(16B)。 */
    private fun openGcm(key: SecretKey, boxed: ByteArray): ByteArray {
        val iv = boxed.copyOfRange(0, IV_BYTES)
        val ctWithTag = boxed.copyOfRange(IV_BYTES, boxed.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        return cipher.doFinal(ctWithTag)
    }
}
