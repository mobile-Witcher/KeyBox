using System.Text.Json;

namespace KeyBox.Core.Config;

/// <summary>
/// 敏感配置读取（ENV_ID + PUBLISHABLE_KEY）。
/// 读取优先级（硬约束：真实值绝不入库，只存在于 gitignore 的本地文件）：
///   1. 环境变量 KEYBOX_ENV_ID / KEYBOX_PUBLISHABLE_KEY
///   2. %APPDATA%\KeyBox\keys.json
///   3. 从 AppContext.BaseDirectory 逐级向上找 keys.json（覆盖从仓库根/输出目录启动的情况）
///   4. 当前工作目录及其上级目录
/// keys.json 形如：{ "ENV_ID": "...", "PUBLISHABLE_KEY": "..." }
/// </summary>
public static class BuildConfig
{
    private const string EnvIdEnvName = "KEYBOX_ENV_ID";
    private const string PublishableKeyEnvName = "KEYBOX_PUBLISHABLE_KEY";

    public static string EnvId { get; }
    public static string PublishableKey { get; }

    static BuildConfig()
    {
        EnvId = Resolve(EnvIdEnvName, "ENV_ID")
                ?? throw new InvalidOperationException(
                    $"未找到 ENV_ID：请设置环境变量 {EnvIdEnvName}，或在 keys.json 中提供 ENV_ID（keys.json 已 gitignore，绝不入库）。");
        PublishableKey = Resolve(PublishableKeyEnvName, "PUBLISHABLE_KEY")
                         ?? throw new InvalidOperationException(
                             $"未找到 PUBLISHABLE_KEY：请设置环境变量 {PublishableKeyEnvName}，或在 keys.json 中提供 PUBLISHABLE_KEY（keys.json 已 gitignore，绝不入库）。");
    }

    /// <summary>按优先级解析单个配置项：环境变量优先，其次 keys.json 文件。</summary>
    private static string? Resolve(string envName, string jsonKey)
    {
        string? env = Environment.GetEnvironmentVariable(envName);
        if (!string.IsNullOrWhiteSpace(env)) return env.Trim();

        string? jsonPath = FindKeysJson();
        if (jsonPath != null)
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
                if (doc.RootElement.TryGetProperty(jsonKey, out var el) && el.ValueKind == JsonValueKind.String)
                {
                    string? v = el.GetString();
                    if (!string.IsNullOrWhiteSpace(v)) return v.Trim();
                }
            }
            catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
            {
                // 配置读取失败不致命：继续尝试其它来源
            }
        }

        return null;
    }

    /// <summary>在当前与上级目录、%APPDATA%\KeyBox、以及程序输出目录的上级链中查找 keys.json。</summary>
    private static string? FindKeysJson()
    {
        string fileName = "keys.json";

        string appData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "KeyBox", fileName);
        if (File.Exists(appData)) return appData;

        // 从输出目录向上找（测试/发布时输出在 bin\...，仓库根在其上）
        string? probe = Path.GetDirectoryName(AppContext.BaseDirectory);
        for (int i = 0; i < 8 && probe != null; i++)
        {
            string candidate = Path.Combine(probe, fileName);
            if (File.Exists(candidate)) return candidate;
            probe = Path.GetDirectoryName(probe);
        }

        // 从当前工作目录向上找
        probe = Directory.GetCurrentDirectory();
        for (int i = 0; i < 8 && probe != null; i++)
        {
            string candidate = Path.Combine(probe, fileName);
            if (File.Exists(candidate)) return candidate;
            probe = Path.GetDirectoryName(probe);
        }

        return null;
    }
}
