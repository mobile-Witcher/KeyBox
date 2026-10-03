using System.Security.Cryptography;
using System.Text;
using KeyBox.Core.Crypto;

namespace KeyBox.Core.Data;

/// <summary>
/// R28 恢复码原语（与 Web crypto.ts / 安卓 KeyBoxCrypto / 鸿蒙 kbrecovery.ets 字节级对齐）。
///
///   恢复码：32 字符标准 base32（无易混字符），分组展示为 XXXX-XXXX-…
///   派生：RK = PBKDF2-HMAC-SHA256(normalize(恢复码), recovery_salt, 600000, 32B)（复用 Kb1Crypto.DeriveKey）
///   包裹：`KBRC1:` + base64( IV(12B) ‖ AES-256-GCM(RK, masterKeyRaw) ‖ GCM tag(16B) )
///   recovery_salt 必须独立于 kdf_salt（入口强校验）
///
/// ⚠️ 服务端边界：recovery_salt / recovery_blob / recovery_ack_at 三列对客户端零列授权，
/// 读写必须走云函数（kbGetMyRole / kbAckRecovery）；存量账号无法后补恢复码——本类只提供原语，不提供生成入口。
/// </summary>
public static class KbRecovery
{
    /// <summary>恢复码包裹前缀（与 Web RECOVERY_PREFIX 一致）。</summary>
    public const string RecoveryPrefix = "KBRC1:";

    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private const int RecoveryCodeLength = 32;
    private const int RecoveryGroupSize = 4;
    private const int IvBytes = 12;
    private const int GcmTagBytes = 16;
    private const int KeyBytes = 32;

    /// <summary>规整用户输入的恢复码：去分隔符与空格、转大写，只保留 base32 字符。</summary>
    public static string NormalizeRecoveryCode(string input)
    {
        var sb = new StringBuilder(input.Length);
        foreach (char ch in input.ToUpperInvariant())
        {
            if (Base32Alphabet.IndexOf(ch) >= 0) sb.Append(ch);
        }
        return sb.ToString();
    }

    /// <summary>把恢复码按 4 字符一组分组（XXXX-XXXX-…），便于抄写。</summary>
    public static string FormatRecoveryCode(string rawCode)
    {
        string normalized = NormalizeRecoveryCode(rawCode);
        var groups = new List<string>();
        for (int i = 0; i < normalized.Length; i += RecoveryGroupSize)
        {
            groups.Add(normalized.Substring(i, Math.Min(RecoveryGroupSize, normalized.Length - i)));
        }
        return string.Join("-", groups);
    }

    /// <summary>
    /// 用恢复码把主密钥（原始 32 字节）包裹成 `KBRC1:` 串。
    /// 入口强校验 recovery_salt 独立于 kdf_salt（不得复用主密码派生盐）。
    /// </summary>
    public static string WrapMasterKeyWithRecovery(
        string recoveryCode,
        string recoverySaltB64,
        string kdfSaltB64,
        byte[] masterKeyRaw)
    {
        if (recoverySaltB64 == kdfSaltB64)
        {
            throw new ArgumentException("recovery_salt 必须独立于 kdf_salt（不得复用主密码派生盐）");
        }
        byte[] rk = DeriveRecoveryKeyRaw(recoveryCode, recoverySaltB64);
        byte[] boxed = SealGcm(rk, masterKeyRaw);
        return RecoveryPrefix + Convert.ToBase64String(boxed);
    }

    /// <summary>反向：用恢复码解开 `KBRC1:` 串，取回主密钥原始 32 字节。恢复码错/密文被改都会抛异常。</summary>
    public static byte[] UnwrapMasterKeyWithRecovery(string recoveryCode, string recoverySaltB64, string recoveryBlob)
    {
        if (!recoveryBlob.StartsWith(RecoveryPrefix, StringComparison.Ordinal))
        {
            throw new FormatException($"恢复码密文前缀不是 {RecoveryPrefix}");
        }
        byte[] rk = DeriveRecoveryKeyRaw(recoveryCode, recoverySaltB64);
        byte[] boxed = Convert.FromBase64String(recoveryBlob.Substring(RecoveryPrefix.Length));
        if (boxed.Length < IvBytes + GcmTagBytes)
        {
            throw new FormatException("恢复码密文长度不足");
        }
        byte[] plain = OpenGcm(rk, boxed);
        if (plain.Length != KeyBytes)
        {
            throw new FormatException("解回的主密钥长度非法");
        }
        return plain;
    }

    /// <summary>由恢复码 + 独立 recovery_salt 派生恢复密钥 RK（32 字节）。</summary>
    private static byte[] DeriveRecoveryKeyRaw(string recoveryCode, string recoverySaltB64)
    {
        string code = NormalizeRecoveryCode(recoveryCode);
        if (code.Length != RecoveryCodeLength)
        {
            throw new ArgumentException("恢复码长度必须为 32 个 base32 字符");
        }
        return Kb1Crypto.DeriveKey(code, recoverySaltB64);
    }

    /// <summary>AES-256-GCM 封装：返回 IV(12B) ‖ 密文 ‖ 标签(16B)。</summary>
    private static byte[] SealGcm(byte[] key, byte[] plaintext)
    {
        byte[] iv = RandomNumberGenerator.GetBytes(IvBytes);
        byte[] ciphertext = new byte[plaintext.Length];
        byte[] tag = new byte[GcmTagBytes];
        using var aes = new AesGcm(key, GcmTagBytes);
        aes.Encrypt(iv, plaintext, ciphertext, tag);

        byte[] boxed = new byte[IvBytes + ciphertext.Length + GcmTagBytes];
        Buffer.BlockCopy(iv, 0, boxed, 0, IvBytes);
        Buffer.BlockCopy(ciphertext, 0, boxed, IvBytes, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, boxed, IvBytes + ciphertext.Length, GcmTagBytes);
        return boxed;
    }

    /// <summary>AES-256-GCM 解封：入参 IV(12B) ‖ 密文 ‖ 标签(16B)。</summary>
    private static byte[] OpenGcm(byte[] key, byte[] boxed)
    {
        int ctLen = boxed.Length - IvBytes - GcmTagBytes;
        byte[] iv = new byte[IvBytes];
        byte[] ciphertext = new byte[ctLen];
        byte[] tag = new byte[GcmTagBytes];
        Buffer.BlockCopy(boxed, 0, iv, 0, IvBytes);
        Buffer.BlockCopy(boxed, IvBytes, ciphertext, 0, ctLen);
        Buffer.BlockCopy(boxed, IvBytes + ctLen, tag, 0, GcmTagBytes);

        byte[] plain = new byte[ctLen];
        using var aes = new AesGcm(key, GcmTagBytes);
        aes.Decrypt(iv, ciphertext, tag, plain);
        return plain;
    }
}
