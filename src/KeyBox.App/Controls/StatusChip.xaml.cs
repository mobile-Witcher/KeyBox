using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace KeyBox.App.Controls;

/// <summary>状态胶囊语义色（W7-E ③）：底色、文字色都取自主题令牌，9 皮肤自动适配。</summary>
public enum StatusTone
{
    Neutral,
    Success,
    Warning,
    Danger,
    Primary,
}

/// <summary>
/// 状态胶囊（W7-E ③）：拟态自 Web 端 <c>.kb-badge</c>，但带语义色。
/// 用法：<c>new StatusChip { Text = "正常", Tone = StatusTone.Success }</c>，或设置 <see cref="Text"/> + <see cref="Tone"/>。
///
/// ⚠️ 之所以不用 XAML 静态绑定 {ThemeResource}：主题字典是运行时**整体替换**的，
///    固定在 XAML 上的画刷引用不会自动重解析；这里每次生效都从 Application.Current.Resources 现取，
///    并订阅 <see cref="Theme.ThemeService.Changed"/>，换肤后面板内的胶囊也能跟着变。
/// </summary>
public sealed partial class StatusChip : UserControl
{
    private static readonly (string Bg, string Fg)[] ToneTokens =
    {
        (Theme.ThemeService.MutedSoft, Theme.ThemeService.Muted),       // Neutral
        (Theme.ThemeService.SuccessSoft, Theme.ThemeService.Success),   // Success
        (Theme.ThemeService.WarningSoft, Theme.ThemeService.Warning),   // Warning
        (Theme.ThemeService.DangerSoft, Theme.ThemeService.Danger),     // Danger
        (Theme.ThemeService.PrimarySoft, Theme.ThemeService.Primary),   // Primary
    };

    public StatusChip()
    {
        InitializeComponent();
        Theme.ThemeService.Changed += ApplyTone;
        Unloaded += (_, _) => Theme.ThemeService.Changed -= ApplyTone;
        ApplyTone();
    }

    /// <summary>胶囊文字。</summary>
    public string Text
    {
        get => ChipText.Text;
        set
        {
            ChipText.Text = value ?? "";
            UpdateVisibility();
        }
    }

    private StatusTone _tone = StatusTone.Neutral;

    /// <summary>语义色调。</summary>
    public StatusTone Tone
    {
        get => _tone;
        set
        {
            _tone = value;
            ApplyTone();
        }
    }

    /// <summary>文本为空时自动隐藏（避免留下空胶囊）。</summary>
    private void UpdateVisibility()
    {
        Visibility = string.IsNullOrEmpty(ChipText.Text) ? Visibility.Collapsed : Visibility.Visible;
    }

    private void ApplyTone()
    {
        (string bgKey, string fgKey) = ToneTokens[(int)_tone];
        ChipRoot.Background = Brush(bgKey) ?? ChipRoot.Background;
        ChipRoot.BorderBrush = Brush(fgKey) is SolidColorBrush fg
            ? new SolidColorBrush(WithAlpha(fg.Color, 0.35))
            : ChipRoot.BorderBrush;
        ChipText.Foreground = Brush(fgKey) ?? ChipText.Foreground;
        UpdateVisibility();
    }

    private static Brush? Brush(string key) => Application.Current?.Resources[key] as Brush;

    private static Windows.UI.Color WithAlpha(Windows.UI.Color c, double alpha)
        => Windows.UI.Color.FromArgb((byte)Math.Clamp(alpha * 255, 0, 255), c.R, c.G, c.B);
}
