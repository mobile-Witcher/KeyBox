using KeyBox.App.Services;
using KeyBox.App.Theme;
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
        // 建窗口前先落主题（皮肤/明暗/强调色），避免首帧用默认色闪一下。
        ThemeService.Initialize();

        _window = new MainWindow();
        AppServices.MainWindow = _window;
        _window.Activate();

        // 窗口就绪后再把明暗落到根元素与标题栏（Initialize 阶段根元素尚不存在）。
        ThemeService.Reapply();
    }
}
