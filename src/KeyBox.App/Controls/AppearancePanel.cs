using KeyBox.App.Theme;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;

namespace KeyBox.App.Controls;

/// <summary>
/// 外观面板（照本仓「对话框/弹层一律代码创建」的惯例，不另开 XAML）：
/// 9 张皮肤色卡（主色块 + 中文名 + hint，选中高亮）+ 三态明暗 + 「跟随 Windows 强调色」开关。
/// 所有改动即时生效（走 <see cref="ThemeService"/> → 主题字典替换 → {ThemeResource Kb*} 重新求值）。
/// </summary>
public sealed class AppearancePanel : UserControl
{
    private readonly Dictionary<string, Border> _skinCards = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<ThemeMode, ToggleButton> _modeButtons = new();
    private ToggleSwitch? _accentSwitch;
    private bool _syncing;

    public AppearancePanel()
    {
        Content = BuildContent();
        ThemeService.Changed += Refresh;
        Unloaded += (_, _) => ThemeService.Changed -= Refresh;
        Refresh();
    }

    /// <summary>从当前主题字典取画刷（换肤后由 Refresh 重新取，故可保持即时生效）。</summary>
    private static Brush B(string key)
        => Application.Current?.Resources[key] as Brush ?? new SolidColorBrush(Microsoft.UI.Colors.Transparent);

    private UIElement BuildContent()
    {
        var root = new StackPanel { Spacing = 12, MinWidth = 320 };

        root.Children.Add(new TextBlock
        {
            Text = "外观",
            FontSize = 15,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        });

        // ── 明暗三态 ──
        var modeRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        foreach ((ThemeMode mode, string label) in new[]
                 {
                     (ThemeMode.System, "跟随系统"),
                     (ThemeMode.Light, "浅色"),
                     (ThemeMode.Dark, "深色"),
                 })
        {
            var btn = new ToggleButton { Content = label, MinWidth = 88 };
            btn.Click += (_, _) =>
            {
                if (_syncing)
                {
                    return;
                }

                ThemeService.SetMode(mode);
            };
            _modeButtons[mode] = btn;
            modeRow.Children.Add(btn);
        }

        root.Children.Add(modeRow);

        // ── 9 张皮肤色卡 ──
        var list = new StackPanel { Spacing = 6 };
        foreach (SkinInfo skin in ThemeService.Skins)
        {
            var swatch = new Border
            {
                Width = 20,
                Height = 20,
                CornerRadius = new CornerRadius(6),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 10, 0),
            };
            var name = new TextBlock { Text = skin.Label, FontSize = 13 };
            var hint = new TextBlock { Text = skin.Hint, FontSize = 11, TextWrapping = TextWrapping.Wrap };
            var texts = new StackPanel { Spacing = 1 };
            texts.Children.Add(name);
            texts.Children.Add(hint);
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            row.Children.Add(swatch);
            row.Children.Add(texts);

            var card = new Border
            {
                Padding = new Thickness(10, 8, 10, 8),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Child = row,
            };
            card.Tapped += (_, _) =>
            {
                if (!_syncing)
                {
                    ThemeService.SetSkin(skin.Id);
                }
            };
            card.Tag = skin.Id;

            // 色卡预览色由 Refresh() 按各皮肤自己的调色板着色（不跟当前皮肤变）
            _skinCards[skin.Id] = card;
            list.Children.Add(card);
        }

        root.Children.Add(list);

        // ── 跟随 Windows 强调色（第 10 选项，默认关）──
        _accentSwitch = new ToggleSwitch { Header = "跟随 Windows 强调色", OnContent = "开", OffContent = "关" };
        _accentSwitch.Toggled += (_, _) =>
        {
            if (!_syncing)
            {
                ThemeService.SetFollowSystemAccent(_accentSwitch.IsOn);
            }
        };
        root.Children.Add(_accentSwitch);
        root.Children.Add(new TextBlock
        {
            Text = "开启后，主色改用 Windows 的强调色（其余配色仍取自所选皮肤）。",
            FontSize = 11,
            TextWrapping = TextWrapping.Wrap,
        });

        return root;
    }

    /// <summary>刷新选中态与画刷（皮肤/明暗变化后由事件触发）。</summary>
    private void Refresh()
    {
        _syncing = true;
        try
        {
            foreach ((ThemeMode mode, ToggleButton btn) in _modeButtons)
            {
                btn.IsChecked = ThemeService.CurrentMode == mode;
            }

            if (_accentSwitch is not null)
            {
                _accentSwitch.IsOn = ThemeService.FollowSystemAccent;
            }

            bool dark = ThemeService.IsDarkEffective;
            foreach ((string id, Border card) in _skinCards)
            {
                bool selected = string.Equals(id, ThemeService.CurrentSkin, StringComparison.OrdinalIgnoreCase);
                card.BorderBrush = selected ? B(ThemeService.Primary) : B(ThemeService.Border);
                card.BorderThickness = new Thickness(selected ? 2 : 1);
                card.Background = B(ThemeService.Surface);
                if (card.Child is StackPanel row)
                {
                    foreach (UIElement child in row.Children)
                    {
                        switch (child)
                        {
                            case Border swatch:
                                swatch.Background = new SolidColorBrush(Hex(SkinPalettes.Get(id, dark).Primary));
                                break;
                            case StackPanel texts when texts.Children.Count == 2:
                                ((TextBlock)texts.Children[0]).Foreground = B(ThemeService.Text);
                                ((TextBlock)texts.Children[1]).Foreground = B(ThemeService.Muted);
                                break;
                        }
                    }
                }
            }

            // 面板自身：明暗跟随 + 皮肤底色 + 文字色
            // （弹层不继承内容根 RequestedTheme；UserControl 的 Background 默认 null，
            //   不显式刷的话会露出 Flyout 呈现器的默认色，表现为"面板不跟随皮肤"）
            RequestedTheme = ThemeService.CurrentElementTheme;
            Background = B(ThemeService.Surface);
            if (Content is StackPanel root && root.Children.Count > 0)
            {
                if (root.Children[0] is TextBlock title)
                {
                    title.Foreground = B(ThemeService.Text);
                }

                if (root.Children[root.Children.Count - 1] is TextBlock footer)
                {
                    footer.Foreground = B(ThemeService.Muted);
                }
            }
        }
        finally
        {
            _syncing = false;
        }
    }

    /// <summary>生成物里的 "RRGGBB" → Color。</summary>
    private static Windows.UI.Color Hex(string hex)
    {
        string h = hex.TrimStart('#');
        return uint.TryParse(h, System.Globalization.NumberStyles.HexNumber, null, out uint v)
            ? Windows.UI.Color.FromArgb(255, (byte)((v >> 16) & 0xFF), (byte)((v >> 8) & 0xFF), (byte)(v & 0xFF))
            : Microsoft.UI.Colors.Gray;
    }
}
