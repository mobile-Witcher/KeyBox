using KeyBox.App.Pages;
using KeyBox.App.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace KeyBox.App;

/// <summary>主窗口：仅承载 Frame，按会话状态在登录页 / 占位主窗口间导航。</summary>
public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        Title = "KeyBox — 密钥保管箱";
        AppServices.MainWindow = this;
        NavigateToInitial();
    }

    /// <summary>启动导航：本地有会话（session.json）→ 主窗口，否则登录页。</summary>
    public void NavigateToInitial()
    {
        bool loggedIn = AppServices.SessionManager.LoadFromStore() is not null;
        RootFrame.Navigate(loggedIn ? typeof(HomePage) : typeof(LoginPage));
    }

    public void NavigateToHome() => RootFrame.Navigate(typeof(HomePage));

    public void NavigateToLogin() => RootFrame.Navigate(typeof(LoginPage));
}
