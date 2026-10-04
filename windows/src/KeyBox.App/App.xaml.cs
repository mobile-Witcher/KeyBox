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
        // R95-4 诊断日志：WinUI 的异常会以 stowed exception (0xC000027B) 静默终止进程，
        // 看不到任何信息，故把各步骤写入 %TEMP%\keybox-startup.log 以便定位。
        var __log = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "keybox-startup.log");
        void __step(string s) { try { System.IO.File.AppendAllText(__log, DateTime.Now.ToString("HH:mm:ss.fff") + "  " + s + Environment.NewLine); } catch { } }
        System.IO.File.WriteAllText(__log, "=== KeyBox 启动 " + DateTime.Now + " ===" + Environment.NewLine);
        __step("OnLaunched 进入");
        try
        {
            // 建窗口前先落主题（皮肤/明暗/强调色），避免首帧用默认色闪一下。
            ThemeService.Initialize();
            __step("ThemeService.Initialize 完成");

            _window = new MainWindow();
            __step("MainWindow 构造完成（XAML 已加载）");
            AppServices.MainWindow = _window;
            _window.Activate();
            // 窗口内容就绪后再把 XamlRoot 交给托盘菜单：TaskbarIcon 不在视觉树里，
            // 其 ContextFlyout 拿不到 XamlRoot 会导致「托盘菜单点了全都没反应」。
            _window.AttachTrayXamlRoot();
            __step("Activate 完成");

            // 窗口就绪后再把明暗落到根元素与标题栏（Initialize 阶段根元素尚不存在）。
            ThemeService.Reapply();
            __step("ThemeService.Reapply 完成 —— 启动成功");
        }
        catch (Exception ex)
        {
            __step("!!! 启动异常: " + ex.GetType().FullName + " : " + ex.Message);
            if (ex.InnerException is not null) { __step("    Inner: " + ex.InnerException.GetType().FullName + " : " + ex.InnerException.Message); }
            throw;
        }
    }
}
