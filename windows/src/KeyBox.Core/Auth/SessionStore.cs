using System.Text;
using System.Text.Json;

namespace KeyBox.Core.Auth;

/// <summary>
/// 会话持久化：%APPDATA%\KeyBox\session.json（access/refresh/uid）。
/// 写入采用「临时文件 + 原子替换」，避免崩溃留下半截文件。
/// </summary>
public sealed class SessionStore
{
    /// <summary>默认会话文件路径：%APPDATA%\KeyBox\session.json。</summary>
    public static string DefaultPath { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "KeyBox",
        "session.json");

    private readonly string _path;

    public SessionStore(string? path = null)
    {
        _path = string.IsNullOrWhiteSpace(path) ? DefaultPath : path!;
    }

    public string FilePath => _path;

    /// <summary>持久化会话（幂等；目录不存在自动创建）。</summary>
    public void Save(Session session)
    {
        if (session is null) throw new ArgumentNullException(nameof(session));

        string? dir = Path.GetDirectoryName(_path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        var payload = new
        {
            access_token = session.AccessToken,
            refresh_token = session.RefreshToken,
            uid = session.Uid,
            expires_in = session.ExpiresIn,
            saved_at = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
        };
        string json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });

        string tmp = _path + ".tmp";
        File.WriteAllText(tmp, json, new UTF8Encoding(false));
        File.Move(tmp, _path, overwrite: true);
    }

    /// <summary>读取会话；文件不存在 / 损坏 / 缺 access_token 一律返回 null（不抛错）。</summary>
    public Session? Load()
    {
        if (!File.Exists(_path)) return null;

        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(_path));
            var root = doc.RootElement;
            string accessToken = GetString(root, "access_token");
            if (string.IsNullOrEmpty(accessToken)) return null;

            return new Session(
                accessToken,
                GetString(root, "refresh_token"),
                GetLong(root, "expires_in") ?? 7200L,
                GetString(root, "uid"));
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>删除本地会话文件（退出登录）。</summary>
    public void Delete()
    {
        if (File.Exists(_path)) File.Delete(_path);
    }

    private static string GetString(JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String)
        {
            return prop.GetString() ?? "";
        }
        return "";
    }

    private static long? GetLong(JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.Number && prop.TryGetInt64(out long v))
        {
            return v;
        }
        return null;
    }
}
