using System.Security.Cryptography;
using KeyBox.Core.Crypto;
using Xunit;

namespace KeyBox.Core.Tests;

/// <summary>
/// 加密互通向量测试 —— W1 核心交付物。
/// 断言 harmonyInterop.test.ts 的全部官方向量在 C# 下逐字节通过：
///   1. 官方派生向量：password/salt/iterations → 32 字节密钥 hex 完全一致；
///   2. 双向整链路：EncryptToKb1 / DecryptFromKb1 与 Node(鸿蒙参考实现) 交叉互解；
///   3. 确定性 KB1 向量（固定 IV，由 Node AES-256-GCM 生成）在 C# 下可解开 → 字节级互通铁证；
///   4. 前缀 / 篡改 / 错钥 的失败路径。
/// </summary>
public class CryptoVectorTests
{
    // harmonyInterop.test.ts VECTOR（Phase 0 固化于 2026-09-29，此后不得变更）
    private const string VectorPassword = "keybox-harmony-vector-2026";
    private const string VectorSaltB64 = "c2FsdDEyMzQ1Njc4OTAxMjM0NQ==";
    private const int VectorIterations = 600000;
    private const string VectorDerivedKeyHex = "b72f738df26e5ce18b7dc821b26b4ecee39dfa97b4b74f276adc6870c076a33d";

    // harmonyInterop.test.ts 互通测试用数据
    private const string TestPassword = "correct-horse-battery-staple";
    private const string TestSaltB64 = "YWJjZGVmZ2hpamtsbW5vcA=="; // "abcdefghijklmnop"
    private const int TestIterations = 600000;
    private const string TestPlain = "KeyBox interoperability 模型名 gpt-4o 深入测试";

    // 确定性 KB1 向量：key=PBKDF2(TestPassword, TestSaltB64, 600000, SHA256),
    // IV=固定 "0123456789ab"(12B)，由 Node crypto (aes-256-gcm) 生成 —— 与 harmonyEncrypt 完全同构。
    // 生成脚本见开发记录；任何一侧改动参数都必须重算并同步。
    private const string NodeGeneratedKb1 =
        "KB1:MDEyMzQ1Njc4OWFiA885zHhnwA7tdNB6drmsnfhJzpEnmwCfyS7DkHm1U2O4Sd5TyPpdrTuD5j9kUH3YYMwHLG4A/M9StluFGtMyXynNAqUF";

    [Fact]
    public void DeriveKey_Matches_OfficialVector_Hex()
    {
        byte[] raw = Kb1Crypto.DeriveKey(VectorPassword, VectorSaltB64, VectorIterations);

        Assert.Equal(32, raw.Length);
        Assert.Equal(VectorDerivedKeyHex, Convert.ToHexString(raw).ToLowerInvariant());
    }

    [Fact]
    public void DeriveKey_ExplicitSha256_NotSha1()
    {
        // 该向量由 Node pbkdf2-sha256 固化；若 .NET 默认 SHA1 或参数有出入必然不相等。
        byte[] raw = Kb1Crypto.DeriveKey(VectorPassword, VectorSaltB64, VectorIterations);
        Assert.Equal(VectorDerivedKeyHex, Convert.ToHexString(raw).ToLowerInvariant());

        // 旁证：SHA1 派生结果与官方向量不同（证明该向量确实区分哈希算法）
        byte[] salt = Convert.FromBase64String(VectorSaltB64);
        using var sha1 = new Rfc2898DeriveBytes(VectorPassword, salt, VectorIterations, HashAlgorithmName.SHA1);
        string sha1Hex = Convert.ToHexString(sha1.GetBytes(32)).ToLowerInvariant();
        Assert.NotEqual(VectorDerivedKeyHex, sha1Hex);
    }

    [Fact]
    public void EncryptThenDecrypt_RoundTrip_Matches_Interop_TestData()
    {
        byte[] key = Kb1Crypto.DeriveKey(TestPassword, TestSaltB64, TestIterations);
        string kb1 = Kb1Crypto.EncryptToKb1(key, TestPlain);

        // 结构断言：KB1: 前缀 + base64(12B iv ‖ ct ‖ 16B tag)
        Assert.StartsWith("KB1:", kb1);
        byte[] boxed = Convert.FromBase64String(kb1["KB1:".Length..]);
        Assert.True(boxed.Length >= 12 + 16, "载荷长度必须 ≥ IV(12) + TAG(16)");
        byte[] iv = boxed[..12];
        byte[] tag = boxed[^16..];
        Assert.Equal(12, iv.Length);
        Assert.Equal(16, tag.Length);

        string plain = Kb1Crypto.DecryptFromKb1(key, kb1);
        Assert.Equal(TestPlain, plain);
    }

    [Fact]
    public void Decrypt_NodeGeneratedKb1_Returns_Exact_Plaintext()
    {
        // 字节级互通铁证：Node(鸿蒙参考实现) 生成的 KB1 串，C# 用同一派生密钥解开得到原文明文。
        byte[] key = Kb1Crypto.DeriveKey(TestPassword, TestSaltB64, TestIterations);
        string plain = Kb1Crypto.DecryptFromKb1(key, NodeGeneratedKb1);

        Assert.Equal(TestPlain, plain);
    }

    [Fact]
    public void Encrypt_Produces_Kb1_That_Node_Decrypts()
    {
        // 反向：C# 加密的 KB1 布局（iv 前 12B、tag 尾 16B）可被 Node harmonyDecrypt 语义解开。
        // 这里用相同规则手工解包校验布局与内容（Node 端即按此规则解包）。
        byte[] key = Kb1Crypto.DeriveKey(TestPassword, TestSaltB64, TestIterations);
        string kb1 = Kb1Crypto.EncryptToKb1(key, TestPlain);

        byte[] boxed = Convert.FromBase64String(kb1["KB1:".Length..]);
        byte[] iv = boxed[..12];
        byte[] tag = boxed[^16..];
        byte[] ct = boxed[12..^16];

        using var aes = new AesGcm(key, 16);
        byte[] plain = new byte[ct.Length];
        aes.Decrypt(iv, ct, tag, plain);

        Assert.Equal(TestPlain, System.Text.Encoding.UTF8.GetString(plain));
    }

    [Fact]
    public void Decrypt_Rejects_Tampered_Ciphertext()
    {
        byte[] key = Kb1Crypto.DeriveKey(TestPassword, TestSaltB64, TestIterations);
        string kb1 = Kb1Crypto.EncryptToKb1(key, "secret payload");

        byte[] boxed = Convert.FromBase64String(kb1["KB1:".Length..]);
        boxed[^1] ^= 0x01; // 翻转 tag 末尾一字节
        string tampered = "KB1:" + Convert.ToBase64String(boxed);

        Assert.ThrowsAny<CryptographicException>(() => Kb1Crypto.DecryptFromKb1(key, tampered));
    }

    [Fact]
    public void Decrypt_Rejects_Wrong_Key()
    {
        byte[] key1 = Kb1Crypto.DeriveKey("password-a", TestSaltB64, TestIterations);
        byte[] key2 = Kb1Crypto.DeriveKey("password-b", TestSaltB64, TestIterations);

        string kb1 = Kb1Crypto.EncryptToKb1(key1, "secret");

        Assert.ThrowsAny<CryptographicException>(() => Kb1Crypto.DecryptFromKb1(key2, kb1));
    }

    [Fact]
    public void Decrypt_Rejects_Bad_Prefix()
    {
        byte[] key = Kb1Crypto.DeriveKey(TestPassword, TestSaltB64, TestIterations);

        Assert.Throws<FormatException>(() => Kb1Crypto.DecryptFromKb1(key, "KB2:AAAA"));
        Assert.Throws<FormatException>(() => Kb1Crypto.DecryptFromKb1(key, "plaintext"));
    }

    [Fact]
    public void GenerateSaltB64_Returns_16_Byte_Base64()
    {
        string saltB64 = Kb1Crypto.GenerateSaltB64();
        byte[] salt = Convert.FromBase64String(saltB64);

        Assert.Equal(16, salt.Length);
    }
}
