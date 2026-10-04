using System.Drawing;
using System.Runtime.InteropServices;
using H.NotifyIcon;
using Microsoft.UI.Xaml.Controls;

namespace KeyBox.App.Services;

/// <summary>
/// 系统托盘（H.NotifyIcon.WinUI）：常驻图标 + 右键菜单（显示/隐藏、锁定、退出）。
/// 创建失败（极老系统 / 资源缺失）时静默降级为「无托盘」，不影响主功能。
/// </summary>
/// <remarks>
/// W6-A 修复（交接书 §6.1，根因三条）：
/// <list type="number">
/// <item>
/// H.NotifyIcon 2.0.131 的 <see cref="TaskbarIcon"/> 只在 **作为 XAML 视觉树元素** 时才靠自身
/// <c>Loaded</c> 事件自动建档（见库源码 TaskbarIcon.cs 构造函数里的 <c>Loaded += ... ForceCreate(...)</c>）。
/// 本项目是纯代码 <c>new</c> 出来、从不入视觉树 → <c>Loaded</c> 永不触发 → 源码零 <c>ForceCreate</c> 即零建档。
/// 故必须显式建档。
/// </item>
/// <item>
/// 建档必须**同步**拿到图标：<see cref="TaskbarIcon.IconSource"/> 走的是异步解码
/// （库源码 TaskbarIcon.IconSource.cs：<c>await newValue.ToIconAsync()</c>），而
/// <c>TrayIcon.Create()</c> 只把**当前** HICON 交给 Shell_NotifyIcon —— 异步未完成就会以空图标建档，
/// 表现为「托盘出现但无图标」。故改用 <see cref="TaskbarIcon.Icon"/>（<see cref="Icon"/>）从文件**同步**加载。
/// </item>
/// <item>
/// <see cref="Created"/> 只在**真正建档成功**后为 <see langword="true"/>；关窗逻辑据此决定
/// 「藏窗口（托盘可唤回）」还是「真退出」。绝不出现「进程活着但没有任何入口」。
/// </item>
/// </list>
/// </remarks>
public sealed class TrayIconService : IDisposable
{
    /// <summary>托盘图标资源：随输出目录复制（csproj 的 <c>Content Include="Assets\**"</c>）。</summary>
    private const string IconIcoRelativePath = @"Assets\keybox.ico";

    /// <summary>PNG 回退（ICO 缺失/损坏时使用）。</summary>
    private const string IconPngRelativePath = @"Assets\keybox.png";

    /// <summary><see cref="Icon.FromHandle"/> 只借句柄不持有，取完副本后须自行释放，否则 GDI 句柄泄漏。</summary>
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    private readonly TaskbarIcon? _icon;

    /// <summary>保存引用：纯代码创建的 TaskbarIcon 不在视觉树里，其菜单需要外部补 XamlRoot（见 AttachXamlRoot）。</summary>
    private readonly MenuFlyout? _flyout;

    /// <summary>托盘是否真的建出来了（外部据此决定关窗行为，必须真实）。</summary>
    public bool Created { get; }

    /// <summary>
    /// 把主窗口的 XamlRoot 补到托盘菜单上。
    /// 背景：本项目的 TaskbarIcon 是纯代码 new 出来、从不入视觉树，其 ContextFlyout 因此拿不到
    /// XamlRoot，WinUI 3 无法实现该 Flyout —— 表现为「托盘图标在，但菜单点了全都没反应」。
    /// 窗口内容就绪后由 MainWindow 调用本方法补上即可。
    /// </summary>
    public void AttachXamlRoot(Microsoft.UI.Xaml.XamlRoot? root)
    {
        if (_flyout is null || root is null) { return; }
        try
        {
            _flyout.XamlRoot = root;
            foreach (var item in _flyout.Items)
            {
                if (item is Microsoft.UI.Xaml.UIElement el && el.XamlRoot is null) { el.XamlRoot = root; }
            }
        }
        catch
        {
            // 补 XamlRoot 失败不影响主功能（最坏情况仍是无托盘菜单）
        }
    }

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
            _flyout = flyout;
            flyout.Items.Add(MenuItem("显示 KeyBox", showWindow));
            flyout.Items.Add(MenuItem("隐藏窗口", hideWindow));
            flyout.Items.Add(MenuItem("立即锁定", lockNow));
            flyout.Items.Add(new MenuFlyoutSeparator());
            flyout.Items.Add(MenuItem("退出", exitApp));

            // 图标取不到就当作建档失败（宁可无托盘，也不要「托盘在但一片空白」的假成功）。
            Icon trayImage = LoadIconFromAsset()
                ?? throw new InvalidOperationException($"托盘图标资源缺失：{Path.Combine(AppContext.BaseDirectory, IconIcoRelativePath)} / {Path.Combine(AppContext.BaseDirectory, IconPngRelativePath)}");

            _icon = new TaskbarIcon
            {
                ToolTipText = toolTip,
                ContextFlyout = flyout,
                // 同步就位（不是 IconSource 的异步解码），保证 ForceCreate 时 HICON 已是真实图标。
                Icon = trayImage,
            };

            // 纯代码创建（不入视觉树）→ Loaded 不触发，必须显式建档。
            // enablesEfficiencyMode:false 与库自身 Loaded 路径保持一致：本应用有可见主窗口，
            // 不应把进程压进 EcoQoS（托盘建档与效率模式无关，传 false 一样能出图标）。
            _icon.ForceCreate(enablesEfficiencyMode: false);

            Created = _icon.IsCreated;
        }
        catch
        {
            // 建档失败（含图标资源缺失、Shell_NotifyIcon 失败）→ 如实降级为「无托盘」。
            Created = false;
        }
    }

    /// <summary>
    /// 同步取托盘图标：优先多尺寸 ICO（Shell 按 DPI 取合适帧，比 PNG 缩放更清晰），
    /// ICO 缺失/损坏时回退到 PNG 转 HICON。两者都拿不到即视为失败（不静默给空白占位）。
    /// </summary>
    private static Icon? LoadIconFromAsset()
    {
        string ico = Path.Combine(AppContext.BaseDirectory, IconIcoRelativePath);
        if (File.Exists(ico))
        {
            try
            {
                return new Icon(ico, 32, 32);
            }
            catch
            {
                // ICO 损坏 → 走 PNG 回退
            }
        }

        string path = Path.Combine(AppContext.BaseDirectory, IconPngRelativePath);
        if (!File.Exists(path))
        {
            return null;
        }

        using var bitmap = new Bitmap(path);
        IntPtr handle = bitmap.GetHicon();
        try
        {
            using Icon borrowed = Icon.FromHandle(handle);
            // Clone 拥有独立句柄，可在 DestroyIcon 之后继续使用。
            return (Icon)borrowed.Clone();
        }
        finally
        {
            DestroyIcon(handle);
        }
    }

    private static MenuFlyoutItem MenuItem(string text, Action action)
    {
        // 关键（H.NotifyIcon + WinUI 的坑）：本库默认走「Win32 PopupMenu 转换」模式，
        // 原生弹窗只会调用 MenuFlyoutItem 的 **Command**，**不会**触发 WinUI 的 Click 事件。
        // 此前只挂 Click ⇒ 菜单能弹出但点任何一项都没反应。这里改用 Command。
        var item = new MenuFlyoutItem
        {
            Text = text,
            Icon = new SymbolIcon(Symbol.Setting),
            Command = new CommunityToolkit.Mvvm.Input.RelayCommand(action),
        };
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
