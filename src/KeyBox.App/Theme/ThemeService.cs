using System.Globalization;
using KeyBox.App.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Windows.UI.ViewManagement;

namespace KeyBox.App.Theme;

/// <summary>明暗三态（对齐鸿蒙端 darkMode: system|light|dark）。</summary>
public enum ThemeMode
{
    System,
    Light,
    Dark,
}

/// <summary>
/// 主题服务：把 <see cref="SkinPalettes"/> 的 9 皮肤 × 浅/深（+ 可选「跟随 Windows 强调色」）
/// 渲染成 WinUI 资源字典（<c>Kb*</c> 画刷 + 形状/字体令牌），运行时替换即**即时换肤**。
///
/// 设计约束：
/// <list type="bullet">
/// <item>只定义自己的 <c>Kb*</c> 键，**不劫持 WinUI 系统键**（避免系统控件内部取色错乱）。</item>
/// <item>WinUI 自身控件外观（滚动条/控件底）由根元素 <c>RequestedTheme</c> 负责，与本服务的皮肤色正交。</item>
/// <item>色值来自生成物 <see cref="SkinPalettes"/>（源：index.css → 安卓 Skins.kt，含 AA 校准）。</item>
/// </list>
/// </summary>
public static class ThemeService
{
    // ---- 画刷键（XAML 用 {ThemeResource KbXxxBrush} 引用，ThemeResource 保证换肤后重新求值）----
    public const string Bg = "KbBgBrush";
    public const string Surface = "KbSurfaceBrush";
    public const string Surface2 = "KbSurface2Brush";
    public const string Text = "KbTextBrush";
    public const string Muted = "KbMutedBrush";
    public const string Border = "KbBorderBrush";
    public const string BorderStrong = "KbBorderStrongBrush";
    public const string Primary = "KbPrimaryBrush";
    public const string PrimaryHover = "KbPrimaryHoverBrush";
    public const string OnPrimary = "KbOnPrimaryBrush";
    public const string Ring = "KbRingBrush";
    public const string Danger = "KbDangerBrush";
    public const string Success = "KbSuccessBrush";
    public const string Warning = "KbWarningBrush";
    public const string WarningSoft = "KbWarningSoftBrush";
    public const string DangerSoft = "KbDangerSoftBrush";

    // ---- W7-E 新增：语义"软底色"（状态胶囊/空态/骨架屏用）----
    public const string SuccessSoft = "KbSuccessSoftBrush";
    public const string MutedSoft = "KbMutedSoftBrush";
    public const string PrimarySoft = "KbPrimarySoftBrush";

    // ---- 形状/字体令牌键 ----
    public const string CornerRadius = "KbCornerRadius";
    public const string CardCornerRadius = "KbCardCornerRadius";
    public const string FontFamily = "KbFontFamily";
    public const string HeadingTracking = "KbHeadingTracking";
    public const string ShadowRecipe = "KbShadowRecipe";

    private static readonly List<string> SkinOrder = new();
    private static ResourceDictionary? _current;
    private static AppSettingsStore? _store;

    /// <summary>当前皮肤 id（default/tech/…/sunset）。</summary>
    public static string CurrentSkin { get; private set; } = "default";

    /// <summary>当前明暗模式。</summary>
    public static ThemeMode CurrentMode { get; private set; } = ThemeMode.System;

    /// <summary>是否「跟随 Windows 强调色」（覆盖皮肤的 primary 系列，默认关）。</summary>
    public static bool FollowSystemAccent { get; private set; }

    /// <summary>当前实际生效的明暗（System 模式下解析为系统值）。</summary>
    public static bool IsDarkEffective { get; private set; }

    /// <summary>皮肤或明暗变化后触发（供外观面板刷新选中态）。</summary>
    public static event Action? Changed;

    /// <summary>可选皮肤清单（含顺序）。</summary>
    public static IReadOnlyList<SkinInfo> Skins => SkinPalettes.Skins;

    static ThemeService()
    {
        foreach (SkinInfo s in SkinPalettes.Skins)
        {
            SkinOrder.Add(s.Id);
        }
    }

    /// <summary>启动时调用（App.OnLaunched，创建窗口前）：读设置并落主题。</summary>
    public static void Initialize()
    {
        _store ??= new AppSettingsStore();
        AppSettings s = _store.Load();
        ApplyInternal(s.Skin, ParseMode(s.ThemeMode), s.UseSystemAccent, persist: false);
    }

    public static void SetSkin(string skinId) => ApplyInternal(skinId, CurrentMode, FollowSystemAccent, persist: true);

    public static void SetMode(ThemeMode mode) => ApplyInternal(CurrentSkin, mode, FollowSystemAccent, persist: true);

    public static void SetFollowSystemAccent(bool enabled) => ApplyInternal(CurrentSkin, CurrentMode, enabled, persist: true);

    /// <summary>
    /// 窗口就绪后调用：把明暗落到根元素（WinUI 控件外观）与标题栏。
    /// <see cref="Initialize"/> 阶段根元素还不存在，故启动时由 App.OnLaunched 在建窗后补一次。
    /// </summary>
    public static void Reapply()
    {
        ApplyRootTheme(CurrentMode);
        ApplyTitleBar(IsDarkEffective);
        Changed?.Invoke();
    }

    /// <summary>明暗模式 ↔ 存储字符串。</summary>
    public static ThemeMode ParseMode(string? value) => value?.ToLowerInvariant() switch
    {
        "light" => ThemeMode.Light,
        "dark" => ThemeMode.Dark,
        _ => ThemeMode.System,
    };

    public static string ToStorage(ThemeMode mode) => mode switch
    {
        ThemeMode.Light => "light",
        ThemeMode.Dark => "dark",
        _ => "system",
    };

    /// <summary>取某皮肤的主色（供外观面板画色卡）。</summary>
    public static Color PreviewPrimary(string skinId, bool dark)
    {
        SkinColors c = SkinPalettes.Get(skinId, dark);
        return FollowSystemAccent ? SystemAccent() : ParseHex(c.Primary);
    }

    /// <summary>取某皮肤的背景色（供色卡底色）。</summary>
    public static Color PreviewBackground(string skinId, bool dark) => ParseHex(SkinPalettes.Get(skinId, dark).Background);

    private static void ApplyInternal(string skinId, ThemeMode mode, bool followAccent, bool persist)
    {
        CurrentSkin = SkinOrder.Contains(skinId) ? skinId : "default";
        CurrentMode = mode;
        FollowSystemAccent = followAccent;
        IsDarkEffective = mode switch
        {
            ThemeMode.Dark => true,
            ThemeMode.Light => false,
            _ => Application.Current?.RequestedTheme == ApplicationTheme.Dark,
        };

        ResourceDictionary dict = Build(CurrentSkin, IsDarkEffective, followAccent);

        // 只替换自己那一份 merged dictionary，XamlControlsResources 保持不动。
        if (Application.Current is { } app)
        {
            if (_current is not null)
            {
                app.Resources.MergedDictionaries.Remove(_current);
            }

            app.Resources.MergedDictionaries.Add(dict);
            _current = dict;
        }

        ApplyRootTheme(mode);
        ApplyTitleBar(IsDarkEffective);

        if (persist)
        {
            Persist();
        }

        Changed?.Invoke();
    }

    /// <summary>把明暗落到根元素（WinUI 控件外观），System 用 Default 交还系统。</summary>
    private static void ApplyRootTheme(ThemeMode mode)
    {
        try
        {
            if (AppServices.MainWindow?.Content is FrameworkElement root)
            {
                root.RequestedTheme = mode switch
                {
                    ThemeMode.Light => ElementTheme.Light,
                    ThemeMode.Dark => ElementTheme.Dark,
                    _ => ElementTheme.Default,
                };
            }
        }
        catch
        {
            // 根元素尚未就绪时忽略（启动早期）
        }
    }

    /// <summary>标题栏跟着皮肤走（不支持时静默跳过）。</summary>
    private static void ApplyTitleBar(bool dark)
    {
        try
        {
            MainWindow? w = AppServices.MainWindow;
            if (w is null)
            {
                return;
            }

            if (!Microsoft.UI.Windowing.AppWindowTitleBar.IsCustomizationSupported())
            {
                return;
            }

            SkinColors c = SkinPalettes.Get(CurrentSkin, dark);
            Microsoft.UI.Windowing.AppWindowTitleBar bar = w.AppWindow.TitleBar;
            bar.BackgroundColor = ParseHex(c.Surface);
            bar.ForegroundColor = ParseHex(c.OnSurface);
            bar.InactiveBackgroundColor = ParseHex(c.Surface);
            bar.InactiveForegroundColor = ParseHex(c.OnSurfaceVariant);
            bar.ButtonBackgroundColor = ParseHex(c.Surface);
            bar.ButtonForegroundColor = ParseHex(c.OnSurface);
            bar.ButtonInactiveBackgroundColor = ParseHex(c.Surface);
            bar.ButtonInactiveForegroundColor = ParseHex(c.OnSurfaceVariant);
        }
        catch
        {
            // 标题栏自定义失败不影响功能
        }
    }

    private static void Persist()
    {
        try
        {
            AppSettings cur = _store?.Load() ?? new AppSettings();
            _store?.Save(cur with
            {
                Skin = CurrentSkin,
                ThemeMode = ToStorage(CurrentMode),
                UseSystemAccent = FollowSystemAccent,
            });
        }
        catch
        {
            // 持久化失败不影响本次会话
        }
    }

    /// <summary>构造主题资源字典。</summary>
    private static ResourceDictionary Build(string skinId, bool dark, bool followAccent)
    {
        SkinColors c = SkinPalettes.Get(skinId, dark);
        SkinShape shape = SkinPalettes.GetShape(skinId);

        Color bg = ParseHex(c.Background);
        Color surface = ParseHex(c.Surface);
        Color surface2 = ParseHex(c.SurfaceVariant);
        Color text = ParseHex(c.OnSurface);
        Color muted = ParseHex(c.OnSurfaceVariant);
        Color border = ParseHex(c.OutlineVariant);
        Color borderStrong = ParseHex(c.Outline);
        Color primary = followAccent ? SystemAccent() : ParseHex(c.Primary);
        Color onPrimary = followAccent ? ReadableOn(primary) : ParseHex(c.OnPrimary);
        Color danger = ParseHex(c.Error);
        Color success = ParseHex(c.Success);
        Color warning = ParseHex(c.Warning);

        var d = new ResourceDictionary();
        d[Bg] = Brush(bg);
        d[Surface] = Brush(surface);
        d[Surface2] = Brush(surface2);
        d[Text] = Brush(text);
        d[Muted] = Brush(muted);
        d[Border] = Brush(border);
        d[BorderStrong] = Brush(borderStrong);
        d[Primary] = Brush(primary);
        // hover 由主色向黑白方向微调（WinUI 3 无 Colors 静态类，直接构造以免命名空间歧义）
        Color hoverToward = dark
            ? Color.FromArgb(255, 255, 255, 255)
            : Color.FromArgb(255, 0, 0, 0);
        d[PrimaryHover] = Brush(Mix(primary, hoverToward, 0.12));
        d[OnPrimary] = Brush(onPrimary);
        d[Ring] = Brush(WithAlpha(primary, 0.55));
        d[Danger] = Brush(danger);
        d[Success] = Brush(success);
        d[Warning] = Brush(warning);
        d[WarningSoft] = Brush(Mix(surface, warning, dark ? 0.22 : 0.14));
        d[DangerSoft] = Brush(Mix(surface, danger, dark ? 0.22 : 0.12));
        // W7-E：语义软底色（状态胶囊/空态/骨架屏用）。深色下提高混合比，保证暗底上也能看出色块。
        d[SuccessSoft] = Brush(Mix(surface, success, dark ? 0.24 : 0.14));
        d[MutedSoft] = Brush(Mix(surface, muted, dark ? 0.20 : 0.10));
        d[PrimarySoft] = Brush(Mix(surface, primary, dark ? 0.26 : 0.14));

        // 形状/字体令牌：圆角来自 index.css，字体族按平台映射后已存在生成物里。
        d[CornerRadius] = new CornerRadius(shape.Radius);
        d[CardCornerRadius] = new CornerRadius(shape.CardRadius);
        d[FontFamily] = new FontFamily(shape.FontFamily ?? "Segoe UI");
        d[HeadingTracking] = shape.HeadingTracking;
        d[ShadowRecipe] = shape.ShadowRecipe;
        return d;
    }

    private static SolidColorBrush Brush(Color c) => new(c);

    /// <summary>Windows 强调色（用户可关的第 10 选项）。</summary>
    private static Color SystemAccent()
    {
        try
        {
            return new UISettings().GetColorValue(UIColorType.Accent);
        }
        catch
        {
            return ParseHex(SkinPalettes.Get("default", false).Primary);
        }
    }

    /// <summary>强调色上的可读文字色（按亮度取黑/白）。</summary>
    private static Color ReadableOn(Color background)
        => Luminance(background) > 0.5 ? Color.FromArgb(255, 10, 10, 10) : Color.FromArgb(255, 250, 250, 250);

    /// <summary>线性混合（t=0 取 a，t=1 取 b），用于派生 hover / 浅底。</summary>
    private static Color Mix(Color a, Color b, double t)
    {
        byte L(byte x, byte y) => (byte)Math.Clamp(x + ((y - x) * t), 0, 255);
        return Color.FromArgb(255, L(a.R, b.R), L(a.G, b.G), L(a.B, b.B));
    }

    private static Color WithAlpha(Color c, double alpha)
        => Color.FromArgb((byte)Math.Clamp(alpha * 255, 0, 255), c.R, c.G, c.B);

    /// <summary>WCAG 相对亮度（0=黑，1=白）。</summary>
    private static double Luminance(Color c)
    {
        static double Ch(byte v)
        {
            double s = v / 255.0;
            return s <= 0.03928 ? s / 12.92 : Math.Pow((s + 0.055) / 1.055, 2.4);
        }

        return (0.2126 * Ch(c.R)) + (0.7152 * Ch(c.G)) + (0.0722 * Ch(c.B));
    }

    /// <summary>HEX（生成物里是无 # 的大写 6 位）→ Color。</summary>
    private static Color ParseHex(string hex)
    {
        string h = hex.TrimStart('#');
        if (h.Length != 6 ||
            !uint.TryParse(h, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out uint v))
        {
            return Color.FromArgb(255, 128, 128, 128);
        }

        return Color.FromArgb(
            255,
            (byte)((v >> 16) & 0xFF),
            (byte)((v >> 8) & 0xFF),
            (byte)(v & 0xFF));
    }
}
