using System.Text.Json;

namespace KeyBox.App.Services;

/// <summary>窗口位置/尺寸（%APPDATA%\KeyBox\window.json，启动还原）。</summary>
public sealed record WindowState(int Left, int Top, int Width, int Height);

/// <summary>
/// 窗口状态记忆：尺寸/位置落 %APPDATA%\KeyBox\window.json，下次启动还原；
/// 还原时按当前显示器工作区夹取，避免恢复到已拔掉的副屏位置。读写失败一律静默。
/// </summary>
public sealed class WindowStateStore
{
    public static string DefaultPath { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "KeyBox",
        "window.json");

    private const int MinWidth = 480;
    private const int MinHeight = 360;

    private readonly string _path;

    public WindowStateStore(string? path = null)
    {
        _path = string.IsNullOrWhiteSpace(path) ? DefaultPath : path!;
    }

    public void Save(int left, int top, int width, int height)
    {
        try
        {
            string? dir = Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            string json = JsonSerializer.Serialize(new WindowState(left, top, width, height));
            File.WriteAllText(_path, json);
        }
        catch
        {
            // 记忆失败不影响使用
        }
    }

    public WindowState? Load()
    {
        try
        {
            if (!File.Exists(_path)) return null;
            WindowState? state = JsonSerializer.Deserialize<WindowState>(File.ReadAllText(_path));
            if (state is null) return null;
            if (state.Width < MinWidth || state.Height < MinHeight) return null;
            return state;
        }
        catch
        {
            return null;
        }
    }
}

/// <summary>应用设置（%APPDATA%\KeyBox\settings.json）。</summary>
/// <remarks>
/// 新增字段一律带默认值：旧 settings.json（只有 MinimizeToTrayOnClose）仍可正常反序列化。
/// ThemeMode 存 "system"/"light"/"dark" 字符串（不用枚举，避免 JSON 里出现魔法数字）。
/// </remarks>
public sealed record AppSettings(
    bool MinimizeToTrayOnClose = true,
    string Skin = "default",
    string ThemeMode = "system",
    bool UseSystemAccent = false);

/// <summary>应用设置的读写（当前仅「关闭窗口最小化到托盘」开关）。</summary>
public sealed class AppSettingsStore
{
    public static string DefaultPath { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "KeyBox",
        "settings.json");

    private readonly string _path;

    public AppSettingsStore(string? path = null)
    {
        _path = string.IsNullOrWhiteSpace(path) ? DefaultPath : path!;
    }

    public AppSettings Load()
    {
        try
        {
            if (!File.Exists(_path)) return new AppSettings();
            return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(_path)) ?? new AppSettings();
        }
        catch
        {
            return new AppSettings();
        }
    }

    public void Save(AppSettings settings)
    {
        try
        {
            string? dir = Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(_path, JsonSerializer.Serialize(settings));
        }
        catch
        {
            // 忽略
        }
    }
}
