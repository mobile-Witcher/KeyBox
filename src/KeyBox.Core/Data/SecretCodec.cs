using System.Text.Json;

namespace KeyBox.Core.Data;

/// <summary>
/// 密钥明文 payload 的解析与展示工具（纯本机，无网络无加密）。
/// 容错照安卓 parseSecretPayload / 鸿蒙 toPlain 模式：缺失/类型不符的字段补空串/空数组，不阻断渲染。
/// </summary>
public static class SecretCodec
{
    /// <summary>
    /// 解析密钥明文 payload JSON。字段缺失/为 null 补空串或空数组；tags 去空去重。
    /// JSON 非法时抛 JsonException（由解密渲染层捕获并标记单条解密失败）。
    /// </summary>
    public static SecretItem ParseSecretPayload(string json)
    {
        using JsonDocument doc = JsonDocument.Parse(json);
        JsonElement root = doc.RootElement;

        string Str(string name) =>
            root.TryGetProperty(name, out JsonElement el) && el.ValueKind == JsonValueKind.String
                ? el.GetString() ?? ""
                : "";

        var tags = new List<string>();
        if (root.TryGetProperty("tags", out JsonElement tagEl) && tagEl.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement t in tagEl.EnumerateArray())
            {
                string tag = t.ValueKind == JsonValueKind.String ? t.GetString() ?? "" : "";
                if (!string.IsNullOrEmpty(tag) && !tags.Contains(tag))
                {
                    tags.Add(tag);
                }
            }
        }

        return new SecretItem(
            Site: Str("site"),
            Url: Str("url"),
            Website: Str("website"),
            Model: Str("model"),
            Key: Str("key"),
            Note: Str("note"),
            Tags: tags);
    }

    /// <summary>
    /// 把明文 + tags 序列化成 payload JSON（照安卓 serializeSecretPayload / Web serializePlain 口径）：
    /// 字段 site/url/website/model/key/note；tags 为空时整个省略 tags 键（与旧数据互通）。
    /// </summary>
    public static string SerializeSecretPayload(SecretItem item)
    {
        var payload = new Dictionary<string, object?>
        {
            ["site"] = item.Site,
            ["url"] = item.Url,
            ["website"] = item.Website,
            ["model"] = item.Model,
            ["key"] = item.Key,
            ["note"] = item.Note,
        };
        if (item.Tags.Count > 0)
        {
            payload["tags"] = item.Tags;
        }
        return JsonSerializer.Serialize(payload);
    }

    /// <summary>规整用户输入的分类串：逗号/中文逗号/顿号分隔，去空白去重（照安卓 parseTags）。</summary>
    public static List<string> ParseTags(string raw)
    {
        var tags = new List<string>();
        foreach (string part in raw.Split(',', '，', '、'))
        {
            string tag = part.Trim();
            if (tag.Length > 0 && !tags.Contains(tag))
            {
                tags.Add(tag);
            }
        }
        return tags;
    }

    /// <summary>
    /// 脱敏展示：sk-c8ab…9f2e 形态（首 7 字符 + 省略号 + 末 4 字符；照安卓 maskKey）。
    /// 空 → "（无密钥）"；长度 ≤ 12 → 原样。
    /// </summary>
    public static string MaskKey(string key)
    {
        if (string.IsNullOrEmpty(key)) return "（无密钥）";
        if (key.Length <= 12) return key;
        return key.Substring(0, 7) + "…" + key.Substring(key.Length - 4);
    }
}
