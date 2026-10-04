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

    [Fact]
    public void SerializeSecretPayload_RoundTrips_With_Tags()
    {
        var item = new SecretItem("GitHub", "https://github.com", "github.com", "PAT", "ghp_1", "备注", new List<string> { "dev", "git" });

        string json = SecretCodec.SerializeSecretPayload(item);
        SecretItem parsed = SecretCodec.ParseSecretPayload(json);

        Assert.Equal(item.Site, parsed.Site);
        Assert.Equal(item.Url, parsed.Url);
        Assert.Equal(item.Website, parsed.Website);
        Assert.Equal(item.Model, parsed.Model);
        Assert.Equal(item.Key, parsed.Key);
        Assert.Equal(item.Note, parsed.Note);
        Assert.Equal(item.Tags, parsed.Tags); // List 按内容比较
    }

    [Fact]
    public void SerializeSecretPayload_Omits_Tags_When_Empty()
    {
        var item = new SecretItem("A", "", "", "", "k", "", new List<string>());
        string json = SecretCodec.SerializeSecretPayload(item);

        Assert.DoesNotContain("tags", json);
        Assert.Contains("\"site\":\"A\"", json);
    }

    [Fact]
    public void SerializeSecretPayload_Keeps_Field_Order_For_Interop()
    {
        // 与安卓 serializeSecretPayload 字段顺序一致：site/url/website/model/key/note(/tags)
        var item = new SecretItem("s", "u", "w", "m", "k", "n", new List<string> { "t" });
        string json = SecretCodec.SerializeSecretPayload(item);

        int site = json.IndexOf("\"site\"", StringComparison.Ordinal);
        int url = json.IndexOf("\"url\"", StringComparison.Ordinal);
        int website = json.IndexOf("\"website\"", StringComparison.Ordinal);
        int model = json.IndexOf("\"model\"", StringComparison.Ordinal);
        int key = json.IndexOf("\"key\"", StringComparison.Ordinal);
        int note = json.IndexOf("\"note\"", StringComparison.Ordinal);
        int tags = json.IndexOf("\"tags\"", StringComparison.Ordinal);
        Assert.True(site < url && url < website && website < model && model < key && key < note && note < tags);
    }

    [Fact]
    public void ParseTags_Splits_By_Comma_ChineseComma_Separator_And_Dedups()
    {
        Assert.Equal(new List<string> { "a", "b", "c" }, SecretCodec.ParseTags("a,b，b、c"));
        Assert.Equal(new List<string> { "x" }, SecretCodec.ParseTags(" x , , x "));
        Assert.Empty(SecretCodec.ParseTags(""));
        Assert.Empty(SecretCodec.ParseTags("  ，、  "));
    }
}
