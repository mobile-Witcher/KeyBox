using System.Text.Json;
using KeyBox.Core.Data;
using Xunit;

namespace KeyBox.Core.Tests;

public class BackupCodecTests
{
    private static BackupItem Item(string site, string key, params string[] tags)
        => new(site, "https://u", "w", "gpt-4o", key, "note", tags.ToList(), "2026-10-01T00:00:00Z");

    [Fact]
    public void Encode_Then_Decode_RoundTrips()
    {
        var items = new List<BackupItem>
        {
            Item("OpenAI", "sk-1", "ai", "prod"),
            Item("GitHub", "ghp-2"),
        };

        string json = BackupCodec.Encode("2026-10-02T10:00:00Z", items);
        ParsedBackup parsed = BackupCodec.Decode(json);

        Assert.Equal(0, parsed.Skipped);
        Assert.Equal(2, parsed.Items.Count);
        Assert.Equal("OpenAI", parsed.Items[0].Site);
        Assert.Equal("sk-1", parsed.Items[0].Key);
        Assert.Equal(new List<string> { "ai", "prod" }, parsed.Items[0].Tags);
        Assert.Equal("gpt-4o", parsed.Items[1].Model);
    }

    [Fact]
    public void Encode_Has_Root_Discriminators()
    {
        string json = BackupCodec.Encode("2026-10-02T10:00:00Z", new List<BackupItem> { Item("A", "k") });
        var root = JsonDocument.Parse(json).RootElement;

        Assert.Equal("KeyBox", root.GetProperty("app").GetString());
        Assert.Equal(1, root.GetProperty("version").GetInt32());
        Assert.Equal("2026-10-02T10:00:00Z", root.GetProperty("exportedAt").GetString());
        Assert.Equal(JsonValueKind.Array, root.GetProperty("items").ValueKind);
    }

    [Fact]
    public void Decode_Skips_Entries_Missing_Site_Or_Key()
    {
        const string json = """
            {"app":"KeyBox","version":1,"exportedAt":"x","items":[
              {"site":"Good","key":"k1"},
              {"site":"","key":"k2"},
              {"site":"NoKey"},
              {"site":"Good2","key":"k3"}
            ]}
            """;
        ParsedBackup parsed = BackupCodec.Decode(json);

        Assert.Equal(2, parsed.Items.Count);
        Assert.Equal(2, parsed.Skipped);
    }

    [Fact]
    public void Decode_Normalizes_Tags_Dedup_Trim()
    {
        const string json = """
            {"items":[{"site":"A","key":"k","tags":[" x ","x","","y"]}]}
            """;
        ParsedBackup parsed = BackupCodec.Decode(json);

        Assert.Equal(new List<string> { "x", "y" }, parsed.Items[0].Tags);
    }

    [Fact]
    public void Decode_Missing_Items_Throws()
    {
        Assert.Throws<InvalidOperationException>(() => BackupCodec.Decode("{\"app\":\"KeyBox\"}"));
    }

    [Fact]
    public void Decode_Invalid_Json_Throws()
    {
        Assert.Throws<InvalidOperationException>(() => BackupCodec.Decode("{not json"));
    }

    [Fact]
    public void Decode_Too_Large_Throws()
    {
        string huge = "{\"items\":[\"" + new string('x', 10 * 1024 * 1024 + 10) + "\"]}";
        Assert.Throws<InvalidOperationException>(() => BackupCodec.Decode(huge));
    }

    [Fact]
    public void Decode_Non_Object_Item_Skipped()
    {
        ParsedBackup parsed = BackupCodec.Decode("{\"items\":[123,\"str\",{\"site\":\"A\",\"key\":\"k\"}]}");
        Assert.Single(parsed.Items);
        Assert.Equal(2, parsed.Skipped);
    }
}
