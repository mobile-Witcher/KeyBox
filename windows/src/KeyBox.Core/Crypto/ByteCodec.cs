using System.Text;

namespace KeyBox.Core.Crypto;

/// <summary>
/// 字节 / 字符串编解码工具（不含任何算法创新，仅做编码转换）。
/// 与 Web 端 crypto.ts 的 bytesToBase64 / base64ToBytes / TextEncoder / TextDecoder 行为逐字节一致：
/// UTF-8 明文 ↔ 标准 RFC 4648 base64 ↔ byte[]。
/// </summary>
public static class ByteCodec
{
    /// <summary>UTF-8 编码字符串为字节数组（等价 TextEncoder().encode）。</summary>
    public static byte[] Utf8Encode(string text)
    {
        if (text is null) throw new ArgumentNullException(nameof(text));
        return Encoding.UTF8.GetBytes(text);
    }

    /// <summary>UTF-8 解码字节数组为字符串（等价 TextDecoder().decode）。</summary>
    public static string Utf8Decode(byte[] bytes)
    {
        if (bytes is null) throw new ArgumentNullException(nameof(bytes));
        return Encoding.UTF8.GetString(bytes);
    }

    /// <summary>byte[] → 标准 base64（等价 btoa(String.fromCharCode(...))）。</summary>
    public static string ToBase64(byte[] bytes)
    {
        if (bytes is null) throw new ArgumentNullException(nameof(bytes));
        return Convert.ToBase64String(bytes);
    }

    /// <summary>标准 base64 → byte[]（等价 atob）。容忍标准 base64 的 padding 与 URL-safe 变体。</summary>
    public static byte[] FromBase64(string base64)
    {
        if (string.IsNullOrEmpty(base64)) throw new ArgumentException("base64 不能为空", nameof(base64));
        return Convert.FromBase64String(base64);
    }

    /// <summary>byte[] → 小写 hex（测试与调试用）。</summary>
    public static string ToHex(byte[] bytes)
    {
        if (bytes is null) throw new ArgumentNullException(nameof(bytes));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
