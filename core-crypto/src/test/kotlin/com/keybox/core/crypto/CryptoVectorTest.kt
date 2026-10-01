package com.keybox.core.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 加密层互通向量测试 —— 移植自 Web 仓库 src/lib/harmonyInterop.test.ts（Phase 0 固化向量）。
 *
 * ★ 本测试长期保留：任何一侧改动算法参数（轮数/盐长/IV/格式）都必须同步另一侧并让本测试通过。
 * 向量来源：
 *   - 派生密钥 hex：harmonyInterop.test.ts 官方向量（2026-09-29 固化）+ Node crypto.pbkdf2Sync 交叉生成的第二组向量
 *   - 固定 KB1 解密向量：Node crypto（aes-256-gcm，固定 IV 00..0B）以第二组密钥加密明文生成，
 *     验证 Kotlin 端对 Web/Node 产出的密文能逐字节解开（跨端解密互通）。
 */
class CryptoVectorTest {

    private companion object {
        const val PASSWORD = "correct-horse-battery-staple"
        const val SALT_B64 = "YWJjZGVmZ2hpamtsbW5vcA==" // "abcdefghijklmnop" 的 base64（16 字节）
        const val ITERATIONS = 600_000
        const val PLAIN = "KeyBox interoperability 模型名 gpt-4o 深入测试"

        // 官方测试向量（Phase 0 固化于 2026-09-29，此后不得变更）
        const val VECTOR_PASSWORD = "keybox-harmony-vector-2026"
        const val VECTOR_SALT_B64 = "c2FsdDEyMzQ1Njc4OTAxMjM0NQ=="
        const val VECTOR_DERIVED_KEY_HEX =
            "b72f738df26e5ce18b7dc821b26b4ecee39dfa97b4b74f276adc6870c076a33d"

        // 第二组派生向量（Node crypto.pbkdf2Sync 交叉固化）
        const val VECTOR2_DERIVED_KEY_HEX =
            "b2e9cfed3103ec243c774bd8436a4b5f279d506d01ec7c85b5331bf313e170b2"

        // 固定 KB1 解密向量：密钥 = VECTOR2 密钥，IV = 00 01 ... 0B，明文 = PLAIN
        const val VECTOR_KB1 =
            "KB1:AAECAwQFBgcICQoL6EtpHd5dDb4auuHgEmG811xA95JDUydZoXwrM8tSl7cI2ZLjy92zy6/eRMm8Trf8Ggg8g5yL2Ugf6uXaR6LZT6XUdvE3"
    }

    /** 官方向量：派生密钥 hex（鸿蒙/安卓端开发以此为准）。 */
    @Test
    fun deriveKey_matchesOfficialVectorHex() {
        val raw = KeyBoxCrypto.deriveKey(VECTOR_PASSWORD, VECTOR_SALT_B64, 600_000)
        assertEquals(32, raw.size)
        assertEquals(VECTOR_DERIVED_KEY_HEX, KeyBoxCrypto.bytesToHex(raw))
    }

    /** 第二组向量：登录测试同款密码/盐的派生密钥 hex。 */
    @Test
    fun deriveKey_matchesSecondVectorHex() {
        val raw = KeyBoxCrypto.deriveKey(PASSWORD, SALT_B64, ITERATIONS)
        assertEquals(32, raw.size)
        assertEquals(VECTOR2_DERIVED_KEY_HEX, KeyBoxCrypto.bytesToHex(raw))
    }

    /** 跨端解密互通：能逐字节解开 Web/Node 参考实现产出的固定 KB1 密文。 */
    @Test
    fun decryptFromKb1_decodesFixedCrossPlatformVector() {
        val raw = KeyBoxCrypto.deriveKey(PASSWORD, SALT_B64, ITERATIONS)
        val plain = KeyBoxCrypto.decryptFromKb1(raw, VECTOR_KB1)
        assertEquals(PLAIN, plain)
    }

    /** 自加密 → 自解密往返；密文形态（前缀/IV 内嵌/base64）与 Web crypto.ts 一致。 */
    @Test
    fun encryptDecrypt_roundTrip() {
        val key = KeyBoxCrypto.keyFromRaw(KeyBoxCrypto.deriveKey(PASSWORD, SALT_B64, ITERATIONS))
        val kb1 = KeyBoxCrypto.encryptToKb1(key, PLAIN)
        assertTrue("密文应以 KB1: 开头", kb1.startsWith("KB1:"))
        // base64(IV‖CT‖TAG)：解码后至少 12 + 16 + 明文 UTF-8 字节
        val boxed = java.util.Base64.getDecoder().decode(kb1.removePrefix("KB1:"))
        assertTrue(boxed.size >= 12 + 16 + PLAIN.toByteArray(Charsets.UTF_8).size)
        assertEquals(PLAIN, KeyBoxCrypto.decryptFromKb1(key, kb1))
    }

    /** 每次加密 IV 随机：两次密文不同（IV 内嵌所致），但都能解回同一明文。 */
    @Test
    fun encrypt_isRandomizedPerCall() {
        val key = KeyBoxCrypto.keyFromRaw(KeyBoxCrypto.deriveKey(PASSWORD, SALT_B64, ITERATIONS))
        val kb1a = KeyBoxCrypto.encryptToKb1(key, PLAIN)
        val kb1b = KeyBoxCrypto.encryptToKb1(key, PLAIN)
        assertNotEquals(kb1a, kb1b)
        assertEquals(PLAIN, KeyBoxCrypto.decryptFromKb1(key, kb1a))
        assertEquals(PLAIN, KeyBoxCrypto.decryptFromKb1(key, kb1b))
    }

    /** 篡改检测：密文任一字节被改，GCM 校验必须失败（抛异常而非返回脏数据）。 */
    @Test
    fun decrypt_tamperedCiphertextFails() {
        val key = KeyBoxCrypto.keyFromRaw(KeyBoxCrypto.deriveKey(PASSWORD, SALT_B64, ITERATIONS))
        val boxed = java.util.Base64.getDecoder().decode(VECTOR_KB1.removePrefix("KB1:"))
        boxed[boxed.size - 1] = (boxed[boxed.size - 1].toInt() xor 0x01).toByte()
        val tampered =
            "KB1:" + java.util.Base64.getEncoder().encodeToString(boxed)
        assertThrows(Exception::class.java) { KeyBoxCrypto.decryptFromKb1(key, tampered) }
    }

    /** 前缀不对必须拒绝（与 Web decryptString 行为一致）。 */
    @Test
    fun decrypt_rejectsWrongPrefix() {
        val key = KeyBoxCrypto.keyFromRaw(KeyBoxCrypto.deriveKey(PASSWORD, SALT_B64, ITERATIONS))
        val kb1 = KeyBoxCrypto.encryptToKb1(key, PLAIN)
        assertThrows(IllegalArgumentException::class.java) {
            KeyBoxCrypto.decryptFromKb1(key, "KB2:" + kb1.removePrefix("KB1:"))
        }
    }

    /** 密文被截断必须拒绝（长度 < IV + TAG）。 */
    @Test
    fun decrypt_rejectsTruncatedCiphertext() {
        val key = KeyBoxCrypto.keyFromRaw(KeyBoxCrypto.deriveKey(PASSWORD, SALT_B64, ITERATIONS))
        val boxed = java.util.Base64.getDecoder().decode(VECTOR_KB1.removePrefix("KB1:"))
        val truncated = java.util.Arrays.copyOf(boxed, 20)
        val kb1 = "KB1:" + java.util.Base64.getEncoder().encodeToString(truncated)
        assertThrows(IllegalArgumentException::class.java) { KeyBoxCrypto.decryptFromKb1(key, kb1) }
    }

    /** 盐生成：16 字节、标准 base64（与 Web generateSaltB64 行为一致）。 */
    @Test
    fun generateSalt_is16BytesStdBase64() {
        val saltB64 = KeyBoxCrypto.generateSaltB64()
        val bytes = java.util.Base64.getDecoder().decode(saltB64)
        assertEquals(16, bytes.size)
    }

    /** kdf_verifier 通路：派生 → 加固定串 → 用对/错密码校验。 */
    @Test
    fun masterPasswordVerifier() {
        val saltB64 = KeyBoxCrypto.generateSaltB64()
        val verifier = KeyBoxCrypto.createKeyVerifier(
            KeyBoxCrypto.keyFromRaw(KeyBoxCrypto.deriveKey(PASSWORD, saltB64, ITERATIONS)),
        )
        assertTrue(KeyBoxCrypto.verifyMasterPassword(PASSWORD, saltB64, verifier, ITERATIONS))
        assertTrue(!KeyBoxCrypto.verifyMasterPassword("wrong-password", saltB64, verifier, ITERATIONS))
    }
}
