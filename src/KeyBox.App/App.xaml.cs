using KeyBox.App.Services;
using Microsoft.UI.Xaml;

namespace KeyBox.App;

/// <summary>
/// WinUI 3 应用入口。启动即依据本地会话决定进入登录页或占位主窗口
/// （重启免验证码：%APPDATA%\KeyBox\session.json 存在则直接进主窗口）。
/// </summary>
public partial class App : Application
{
    private MainWindow? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        AppServices.MainWindow = _window;
        _window.Activate();
    }
}
