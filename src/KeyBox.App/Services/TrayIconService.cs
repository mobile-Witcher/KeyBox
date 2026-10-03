using H.NotifyIcon;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;

namespace KeyBox.App.Services;

/// <summary>
/// 系统托盘（H.NotifyIcon.WinUI）：常驻图标 + 右键菜单（显示/隐藏、锁定、退出）。
/// 创建失败（极老系统 / 资源缺失）时静默降级为「无托盘」，不影响主功能。
/// </summary>
public sealed class TrayIconService : IDisposable
{
    private readonly TaskbarIcon? _icon;

    public bool Created { get; }

    public TrayIconService(
        string toolTip,
        Action showWindow,
        Action hideWindow,
        Action lockNow,
        Action exitApp)
    {
        try
        {
            var flyout = new MenuFlyout();
            flyout.Items.Add(MenuItem("显示 KeyBox", showWindow));
            flyout.Items.Add(MenuItem("隐藏窗口", hideWindow));
            flyout.Items.Add(MenuItem("立即锁定", lockNow));
            flyout.Items.Add(new MenuFlyoutSeparator());
            flyout.Items.Add(MenuItem("退出", exitApp));

            _icon = new TaskbarIcon
            {
                ToolTipText = toolTip,
                ContextFlyout = flyout,
                IconSource = new BitmapImage(new Uri("ms-appx:///Assets/keybox.png")),
            };
            Created = true;
        }
        catch
        {
            Created = false;
        }
    }

    private static MenuFlyoutItem MenuItem(string text, Action action)
    {
        var item = new MenuFlyoutItem { Text = text, Icon = new SymbolIcon(Symbol.Setting) };
        item.Click += (_, _) => action();
        return item;
    }

    public void Dispose()
    {
        if (_icon is null) return;
        try
        {
            _icon.Dispose();
        }
        catch
        {
            // 忽略
        }
    }
}
