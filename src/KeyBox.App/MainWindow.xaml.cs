using KeyBox.App.Pages;
using KeyBox.App.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace KeyBox.App;

/// <summary>主窗口：仅承载 Frame，按状态在 登录 → 解锁 → 密钥库 之间导航。</summary>
public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        Title = "KeyBox — 密钥保管箱";
        AppServices.MainWindow = this;
        NavigateToInitial();
    }

    /// <summary>启动导航：无会话 → 登录页；有会话 → 解锁页（Windows Hello 优先，降级主密码）。</summary>
    public void NavigateToInitial()
    {
        bool hasSession = AppServices.SessionManager.LoadFromStore() is not null;
        RootFrame.Navigate(hasSession ? typeof(UnlockPage) : typeof(LoginPage));
    }

    public void NavigateToLogin() => RootFrame.Navigate(typeof(LoginPage));

    public void NavigateToUnlock() => RootFrame.Navigate(typeof(UnlockPage));

    public void NavigateToVault() => RootFrame.Navigate(typeof(VaultPage));
}
