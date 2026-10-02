using KeyBox.Core.Data;
using Xunit;

namespace KeyBox.Core.Tests;

public class SecretCodecTests
{
    [Fact]
    public void ParseSecretPayload_Full_Json()
    {
        const string json = """
            {"site":"GitHub","url":"https://github.com","website":"github.com","model":"PAT","key":"ghp_abc123","note":"备注","tags":["开发","git"]}
            """;
        SecretItem item = SecretCodec.ParseSecretPayload(json);

        Assert.Equal("GitHub", item.Site);
        Assert.Equal("https://github.com", item.Url);
        Assert.Equal("github.com", item.Website);
        Assert.Equal("PAT", item.Model);
        Assert.Equal("ghp_abc123", item.Key);
        Assert.Equal("备注", item.Note);
        Assert.Equal(new List<string> { "开发", "git" }, item.Tags);
    }

    [Fact]
    public void ParseSecretPayload_Missing_Fields_Defaults_Empty()
    {
        SecretItem item = SecretCodec.ParseSecretPayload("{\"site\":\"Only\"}");

        Assert.Equal("Only", item.Site);
        Assert.Equal("", item.Url);
        Assert.Equal("", item.Website);
        Assert.Equal("", item.Model);
        Assert.Equal("", item.Key);
        Assert.Equal("", item.Note);
        Assert.Empty(item.Tags);
    }

    [Fact]
    public void ParseSecretPayload_Null_And_Wrong_Type_Tolerated()
    {
        SecretItem item = SecretCodec.ParseSecretPayload("{\"site\":null,\"key\":123,\"tags\":null}");

        Assert.Equal("", item.Site);
        Assert.Equal("", item.Key);
        Assert.Empty(item.Tags);
    }

    [Fact]
    public void ParseSecretPayload_Tags_Dedup_And_Skip_Empty()
    {
        SecretItem item = SecretCodec.ParseSecretPayload("{\"tags\":[\"a\",\"a\",\"\",\"b\",\"a\"]}");
        Assert.Equal(new List<string> { "a", "b" }, item.Tags);
    }

    [Fact]
    public void ParseSecretPayload_Invalid_Json_Throws()
    {
        Assert.ThrowsAny<System.Text.Json.JsonException>(() => SecretCodec.ParseSecretPayload("{not json"));
    }

    [Fact]
    public void MaskKey_Long_Key_Takes_7_Plus_Ellipsis_Plus_Last4()
    {
        // 照安卓 maskKey：首 7 字符 + … + 末 4 字符
        Assert.Equal("sk-c8ab…9f2e", SecretCodec.MaskKey("sk-c8ab12d3e4f5g6h7i8j9k0l1m2n3o9f2e"));
    }

    [Fact]
    public void MaskKey_Empty_And_Short()
    {
        Assert.Equal("（无密钥）", SecretCodec.MaskKey(""));
        Assert.Equal("shortkey", SecretCodec.MaskKey("shortkey"));
        Assert.Equal("123456789012", SecretCodec.MaskKey("123456789012")); // 12 字符不截断
    }
}
