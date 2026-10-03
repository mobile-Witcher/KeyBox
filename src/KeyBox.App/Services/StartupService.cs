using Microsoft.Win32;

namespace KeyBox.App.Services;

/// <summary>
/// 开机自启（HKCU\Software\Microsoft\Windows\CurrentVersion\Run，无需管理员权限）。
/// MSIX 打包后可迁移到 StartupTask（包身份下 Run 键不可靠），本实现用于当前未打包形态。
/// </summary>
public static class StartupService
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "KeyBox";

    /// <summary>当前是否已注册开机自启（读取失败按未注册处理）。</summary>
    public static bool IsEnabled()
    {
        try
        {
            using RegistryKey? key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            return key?.GetValue(ValueName) is string path && path.Length > 0;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>注册/取消开机自启；返回是否成功（失败不抛，避免打断设置面板）。</summary>
    public static bool SetEnabled(bool enabled)
    {
        try
        {
            using RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
                ?? throw new InvalidOperationException("无法打开 Run 注册表项");
            if (enabled)
            {
                key.SetValue(ValueName, ExeCommand(), RegistryValueKind.String);
            }
            else
            {
                key.DeleteValue(ValueName, throwOnMissingValue: false);
            }
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>自启命令行：带引号的当前可执行文件路径（未打包形态即 KeyBox.App.exe）。</summary>
    private static string ExeCommand()
    {
        string? process = Environment.ProcessPath;
        string exe = !string.IsNullOrEmpty(process)
            ? process!
            : Path.Combine(AppContext.BaseDirectory, "KeyBox.App.exe");
        return $"\"{exe}\"";
    }
}
