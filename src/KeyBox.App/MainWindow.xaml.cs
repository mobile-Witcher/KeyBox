using KeyBox.App.Pages;
using KeyBox.App.Services;
using KeyBox.Core.Vault;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Graphics;
using WinRT.Interop;

namespace KeyBox.App;

/// <summary>
/// 主窗口（W5 集成）：承载 Frame 导航 + Windows 系统集成
/// （系统托盘 / 全局快捷键 Ctrl+Shift+K / 窗口状态记忆 / 关闭窗口最小化到托盘）。
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly WindowStateStore _windowState = new();
    private readonly AppSettingsStore _settingsStore = new();
    private TrayIconService? _tray;
    private GlobalHotKeyService? _hotKey;
    private bool _quitting;

    public MainWindow()
    {
        InitializeComponent();
        Title = "KeyBox — 密钥保管箱";
        AppServices.MainWindow = this;
        NavigateToInitial();

        RestoreWindowState();
        AppWindow.Closing += OnAppWindowClosing;
        SetupTray();
        SetupHotKey();
    }

    // ---- 导航 ----

    /// <summary>启动导航：无会话 → 登录页；有会话 → 解锁页（Windows Hello 优先，降级主密码）。</summary>
    public void NavigateToInitial()
    {
        bool hasSession = AppServices.SessionManager.LoadFromStore() is not null;
        RootFrame.Navigate(hasSession ? typeof(UnlockPage) : typeof(LoginPage));
    }

    public void NavigateToLogin() => RootFrame.Navigate(typeof(LoginPage));

    public void NavigateToUnlock() => RootFrame.Navigate(typeof(UnlockPage));

    public void NavigateToVault() => RootFrame.Navigate(typeof(VaultPage));

    // ---- 窗口状态记忆（%APPDATA%\KeyBox\window.json） ----

    private void RestoreWindowState()
    {
        try
        {
            DisplayArea area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Nearest);
            RectInt32 work = area.WorkArea;
            WindowState? saved = _windowState.Load();

            int width = saved?.Width ?? Math.Min(1200, Math.Max(640, work.Width - 120));
            int height = saved?.Height ?? Math.Min(860, Math.Max(480, work.Height - 120));
            int x = saved?.Left ?? (work.X + Math.Max(0, (work.Width - width) / 2));
            int y = saved?.Top ?? (work.Y + Math.Max(0, (work.Height - height) / 2));

            // 夹取到当前工作区：避免恢复到已拔掉的副屏
            x = Math.Clamp(x, work.X, Math.Max(work.X, work.X + work.Width - width));
            y = Math.Clamp(y, work.Y, Math.Max(work.Y, work.Y + work.Height - height));

            AppWindow.MoveAndResize(new RectInt32(x, y, width, height));
        }
        catch
        {
            // 还原失败用默认窗口即可
        }
    }

    private void SaveWindowState()
    {
        try
        {
            _windowState.Save(
                AppWindow.Position.X, AppWindow.Position.Y,
                AppWindow.Size.Width, AppWindow.Size.Height);
        }
        catch
        {
            // 忽略
        }
    }

    // ---- 关闭行为（默认最小化到托盘） ----

    private void OnAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_quitting) return;
        SaveWindowState();

        if (!_settingsStore.Load().MinimizeToTrayOnClose)
        {
            return; // 用户关闭了「最小化到托盘」→ 真关闭
        }
        args.Cancel = true;
        sender.Hide();
    }

    // ---- 托盘 / 全局快捷键 ----

    private void SetupTray()
    {
        _tray = new TrayIconService(
            "KeyBox — 密钥保管箱",
            ShowMainWindow,
            HideMainWindow,
            LockAndHide,
            QuitApp);
    }

    private void SetupHotKey()
    {
        try
        {
            IntPtr hwnd = WindowNative.GetWindowHandle(this);
            _hotKey = new GlobalHotKeyService(hwnd, ShowMainWindow);
            _hotKey.Register(); // 被其它程序占用时返回 false，静默降级
        }
        catch
        {
            // 热键不可用不影响其它功能
        }
    }

    private void ShowMainWindow()
    {
        try
        {
            AppWindow.Show();
            Activate();
        }
        catch
        {
            // 忽略
        }
    }

    private void HideMainWindow()
    {
        try
        {
            AppWindow.Hide();
        }
        catch
        {
            // 忽略
        }
    }

    /// <summary>立即锁定：抹零内存主密钥并回解锁页（不退出登录）。</summary>
    private void LockAndHide()
    {
        try
        {
            MasterKeySession.Clear();
            NavigateToUnlock();
            AppWindow.Hide();
        }
        catch
        {
            // 忽略
        }
    }

    private void QuitApp()
    {
        _quitting = true;
        _hotKey?.Dispose();
        _hotKey = null;
        _tray?.Dispose();
        _tray = null;
        SaveWindowState();
        try
        {
            Close();
        }
        catch
        {
            // 忽略
        }
    }
}
