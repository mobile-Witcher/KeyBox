using KeyBox.Core.Crypto;
using Xunit;

namespace KeyBox.Core.Tests;

public class ByteCodecTests
{
    [Fact]
    public void Utf8_RoundTrip_Preserves_Unicode()
    {
        const string text = "KeyBox 密钥保管箱 gpt-4o 🎉 深入测试";
        byte[] bytes = ByteCodec.Utf8Encode(text);
        Assert.Equal(text, ByteCodec.Utf8Decode(bytes));
    }

    [Fact]
    public void Base64_RoundTrip_Matches_Standard()
    {
        byte[] bytes = { 0x00, 0x01, 0x02, 0xFE, 0xFF };
        string b64 = ByteCodec.ToBase64(bytes);
        Assert.Equal("AAEC/v8=", b64);
        Assert.Equal(bytes, ByteCodec.FromBase64(b64));
    }

    [Fact]
    public void ToHex_Produces_Lowercase_Hex()
    {
        byte[] bytes = { 0xDE, 0xAD, 0xBE, 0xEF };
        Assert.Equal("deadbeef", ByteCodec.ToHex(bytes));
    }

    [Fact]
    public void FromBase64_Rejects_Empty()
    {
        Assert.Throws<ArgumentException>(() => ByteCodec.FromBase64(""));
    }
}
