using System.Text;
using System.Text.Json;

namespace KeyBox.Core.Data;

/// <summary>
/// R29 备份 JSON 编解码（明文；纯本机，无加密）——照安卓 BackupCodec.kt。
///
/// 文件结构：{ app:"KeyBox", version:1, exportedAt, items:[{site,url,website,model,key,note,updated_at,tags}] }
/// 导入字段校验照鸿蒙 doImport / 安卓 decode：site/key 必填，缺失或非法的条目跳过并计数；超 10MB 抛异常。
/// </summary>
public static class BackupCodec
{
    private const string AppName = "KeyBox";
    private const int Version = 1;
    private const int ImportMaxBytes = 10 * 1024 * 1024;

    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>导出条目列表 → JSON 文本。字段顺序 site/url/website/model/key/note/updated_at/tags。</summary>
    public static string Encode(string exportedAt, IReadOnlyList<BackupItem> items)
    {
        var list = new List<Dictionary<string, object?>>(items.Count);
        foreach (BackupItem item in items)
        {
            list.Add(new Dictionary<string, object?>
            {
                ["site"] = item.Site,
                ["url"] = item.Url,
                ["website"] = item.Website,
                ["model"] = item.Model,
                ["key"] = item.Key,
                ["note"] = item.Note,
                ["updated_at"] = item.UpdatedAt,
                ["tags"] = item.Tags,
            });
        }
        var root = new Dictionary<string, object?>
        {
            ["app"] = AppName,
            ["version"] = Version,
            ["exportedAt"] = exportedAt,
            ["items"] = list,
        };
        return JsonSerializer.Serialize(root, WriteOptions);
    }

    /// <summary>
    /// JSON 文本 → 合法条目（site/key 必填，tags 规整去重）；非法条目跳过计数。
    /// 文件结构非法（缺 items 数组）或超 10MB 抛 InvalidOperationException。
    /// </summary>
    public static ParsedBackup Decode(string text)
    {
        if (Encoding.UTF8.GetByteCount(text) > ImportMaxBytes)
        {
            throw new InvalidOperationException("文件过大（超过 10MB），疑似不是 KeyBox 导出文件");
        }

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(text);
        }
        catch (JsonException)
        {
            throw new InvalidOperationException("文件不是合法 JSON");
        }

        using (doc)
        {
            JsonElement root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("items", out JsonElement itemsEl)
                || itemsEl.ValueKind == JsonValueKind.Null)
            {
                throw new InvalidOperationException("文件结构不是 KeyBox 导出（缺少 items 数组）");
            }
            if (itemsEl.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidOperationException("文件结构不是 KeyBox 导出（items 不是数组）");
            }

            var outItems = new List<SecretItem>();
            int skipped = 0;
            foreach (JsonElement el in itemsEl.EnumerateArray())
            {
                if (el.ValueKind != JsonValueKind.Object)
                {
                    skipped++;
                    continue;
                }
                string site = Str(el, "site").Trim();
                string key = Str(el, "key");
                if (site.Length == 0 || key.Length == 0)
                {
                    skipped++;
                    continue;
                }
                outItems.Add(new SecretItem(
                    Site: site,
                    Url: Str(el, "url").Trim(),
                    Website: Str(el, "website").Trim(),
                    Model: Str(el, "model").Trim(),
                    Key: key,
                    Note: Str(el, "note"),
                    Tags: NormalizeTags(el)));
            }
            return new ParsedBackup(outItems, skipped);
        }
    }

    private static string Str(JsonElement el, string name)
        => el.TryGetProperty(name, out JsonElement prop) && prop.ValueKind == JsonValueKind.String
            ? prop.GetString() ?? ""
            : "";

    /// <summary>tags 缺失/非数组补空数组；去空白、去重（照 toTags 语义）。</summary>
    private static List<string> NormalizeTags(JsonElement el)
    {
        var tags = new List<string>();
        if (!el.TryGetProperty("tags", out JsonElement tagsEl) || tagsEl.ValueKind != JsonValueKind.Array)
        {
            return tags;
        }
        foreach (JsonElement t in tagsEl.EnumerateArray())
        {
            string tag = t.ValueKind == JsonValueKind.String ? (t.GetString() ?? "").Trim() : "";
            if (tag.Length > 0 && !tags.Contains(tag)) tags.Add(tag);
        }
        return tags;
    }
}
