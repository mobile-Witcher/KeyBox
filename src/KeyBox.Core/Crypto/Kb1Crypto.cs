using System.Security.Cryptography;
using System.Text;

namespace KeyBox.Core.Crypto;

/// <summary>
/// KeyBox 客户端加解密（架构 §6 的唯一落地实现；与 Web 端 src/lib/crypto.ts 逐字节一致）。
///
/// 参数表（与 harmonyInterop.test.ts 官方向量严格对齐）：
///   - 派生算法：PBKDF2-HMAC-SHA256（⚠️ .NET 的 Rfc2898DeriveBytes 默认是 SHA1，必须显式传 SHA256）
///   - 迭代次数：600000（OWASP 量级；下限 210000）
///   - 随机盐：16 字节，每账号一份，base64 存储（kb_users.kdf_salt）
///   - 对称加密：AES-256-GCM
///   - IV：每次加密随机 12 字节，内嵌在密文里
///   - 密文格式：`KB1:` + base64( IV(12B) ‖ 密文 ‖ GCM 标签(16B) )
///
/// 注意：WebCrypto 的 AES-GCM 输出即「密文‖标签」；本实现为与 `KB1:` 布局一致，
/// 拆开 tag 后按 IV‖CT‖TAG 顺序拼接/还原，解密时再把 tag 从尾部取出。
/// </summary>
public static class Kb1Crypto
{
    /// <summary>密文前缀（Web crypto.ts SECRET_PREFIX）。</summary>
    public const string SecretPrefix = "KB1:";

    /// <summary>生产迭代次数（架构 §6）。</summary>
    public const int Pbkdf2Iterations = 600000;

    /// <summary>迭代次数下限（架构 §6：为流畅降速也不得低于此值）。</summary>
    public const int Pbkdf2IterationsMin = 210000;

    /// <summary>GCM 标签长度（字节）。</summary>
    public const int GcmTagBytes = 16;

    private const int SaltBytes = 16;
    private const int IvBytes = 12;
    private const int KeyBytes = 32;

    /// <summary>
    /// 用 PBKDF2-HMAC-SHA256 把密码派生成 32 字节主密钥。
    /// 必须显式指定 SHA256——.NET 默认是 SHA1，与 Web/鸿蒙端不一致。
    /// </summary>
    public static byte[] DeriveKey(string password, string saltB64, int iterations = Pbkdf2Iterations)
    {
        if (string.IsNullOrEmpty(password)) throw new ArgumentException("主密码不能为空", nameof(password));
        if (string.IsNullOrEmpty(saltB64)) throw new ArgumentException("盐不能为空", nameof(saltB64));
        if (iterations < 1) throw new ArgumentOutOfRangeException(nameof(iterations), "迭代次数必须为正整数");

        byte[] salt = Convert.FromBase64String(saltB64);
        using var derive = new Rfc2898DeriveBytes(password, salt, iterations, HashAlgorithmName.SHA256);
        return derive.GetBytes(KeyBytes);
    }

    /// <summary>生成 16 字节随机盐并返回 base64（存 kb_users.kdf_salt）。</summary>
    public static string GenerateSaltB64()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(SaltBytes));
    }

    /// <summary>
    /// 把明文字符串加密成 `KB1:` 串。
    /// 布局：`KB1:` + base64( IV(12B) ‖ AES-GCM-CT ‖ GCM-TAG(16B) )。
    /// </summary>
    public static string EncryptToKb1(byte[] key, string plaintext)
    {
        if (key is null) throw new ArgumentNullException(nameof(key));
        if (key.Length != KeyBytes) throw new ArgumentException($"密钥必须为 {KeyBytes} 字节", nameof(key));
        if (plaintext is null) throw new ArgumentNullException(nameof(plaintext));

        byte[] iv = RandomNumberGenerator.GetBytes(IvBytes);
        byte[] plain = Encoding.UTF8.GetBytes(plaintext);
        byte[] ciphertext = new byte[plain.Length];
        byte[] tag = new byte[GcmTagBytes];

        using var aes = new AesGcm(key, GcmTagBytes);
        aes.Encrypt(iv, plain, ciphertext, tag);

        byte[] boxed = new byte[IvBytes + ciphertext.Length + GcmTagBytes];
        Buffer.BlockCopy(iv, 0, boxed, 0, IvBytes);
        Buffer.BlockCopy(ciphertext, 0, boxed, IvBytes, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, boxed, IvBytes + ciphertext.Length, GcmTagBytes);

        return SecretPrefix + Convert.ToBase64String(boxed);
    }

    /// <summary>
    /// 解开 `KB1:` 串。前缀不对抛 FormatException；密文被改或密钥不对抛
    /// CryptographicException（GCM 自带完整性校验）。
    /// </summary>
    public static string DecryptFromKb1(byte[] key, string kb1)
    {
        if (key is null) throw new ArgumentNullException(nameof(key));
        if (key.Length != KeyBytes) throw new ArgumentException($"密钥必须为 {KeyBytes} 字节", nameof(key));
        if (string.IsNullOrEmpty(kb1)) throw new ArgumentException("密文不能为空", nameof(kb1));
        if (!kb1.StartsWith(SecretPrefix, StringComparison.Ordinal))
        {
            throw new FormatException($"密文前缀不是 {SecretPrefix}");
        }

        byte[] boxed;
        try
        {
            boxed = Convert.FromBase64String(kb1.Substring(SecretPrefix.Length));
        }
        catch (FormatException)
        {
            throw new FormatException("KB1 载荷不是合法 base64");
        }

        if (boxed.Length < IvBytes + GcmTagBytes)
        {
            throw new FormatException("密文长度不足，疑似被截断");
        }

        int ctLen = boxed.Length - IvBytes - GcmTagBytes;
        byte[] iv = new byte[IvBytes];
        byte[] tag = new byte[GcmTagBytes];
        byte[] ciphertext = new byte[ctLen];
        Buffer.BlockCopy(boxed, 0, iv, 0, IvBytes);
        Buffer.BlockCopy(boxed, IvBytes, ciphertext, 0, ctLen);
        Buffer.BlockCopy(boxed, IvBytes + ctLen, tag, 0, GcmTagBytes);

        byte[] plain = new byte[ctLen];
        using var aes = new AesGcm(key, GcmTagBytes);
        aes.Decrypt(iv, ciphertext, tag, plain);

        return Encoding.UTF8.GetString(plain);
    }
}
