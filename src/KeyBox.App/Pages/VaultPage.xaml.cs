using KeyBox.App.Controls;
using KeyBox.App.Services;
using KeyBox.App.Theme;
using Microsoft.UI.Xaml.Media;
using KeyBox.App.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace KeyBox.App.Pages;

/// <summary>
/// 密钥库页（W3）：CRUD 编辑对话框 + 本机搜索 + 分类过滤/管理 + 双向同步/冲突 + 复制护栏。
/// 对话框一律代码创建（ContentDialog 实例不可复用，每次 Show 新建）。
/// </summary>
public sealed partial class VaultPage : Page
{
    public VaultViewModel ViewModel { get; }

    public VaultPage()
    {
        ViewModel = new VaultViewModel(AppServices.VaultService, AppServices.SecurityService, AppServices.CurrentUid);
        ViewModel.LogoutRequested += OnLogoutRequested;
        InitializeComponent();
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        await ViewModel.LoadAsync();
        await ViewModel.RefreshRoleAsync(); // 决定「管理」入口可见性（role=admin）
    }

    // ---- 卡片按钮 ----

    private void OnCopyClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: VaultItemViewModel vm })
        {
            ViewModel.CopyKeyCommand.Execute(vm);
        }
    }

    /// <summary>W7-E：密钥「显示 / 隐藏」。先显示才放行复制（VM 会重建集合，让 OneWay 绑定刷新文案与可用性）。</summary>
    private void OnRevealClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: VaultItemViewModel vm })
        {
            ViewModel.ToggleReveal(vm);
        }
    }

    /// <summary>
    /// W7-E：逐字段复制。按钮 Tag 传字段名（site / url / website / model / note / key），
    /// 由 VM.CopyField 统一做可用性判据 + 30 秒剪贴板护栏（照 Web copyField）。
    /// </summary>
    private void OnCopyFieldClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: VaultItemViewModel vm, Tag: string field })
        {
            ViewModel.CopyField(vm, field);
        }
    }

    /// <summary>W7-F：顶栏「外观」按钮（已从代码挂载移入 XAML）——弹出皮肤/明暗面板。</summary>
    private void OnAppearanceClick(object sender, RoutedEventArgs e)
    {
        var panel = new AppearancePanel();
        var flyout = new Flyout { Content = panel };

        // 弹层（Flyout/Dialog）不会继承内容根的 RequestedTheme：直接给面板本体设主题，
        // 并同步自身底色。订阅主题变化做实时同步，关闭时退订（避免事件泄漏）。
        void SyncPanelTheme()
        {
            panel.RequestedTheme = ThemeService.CurrentElementTheme;
            if (Application.Current?.Resources[ThemeService.Surface] is Brush surface)
            {
                panel.Background = surface;
            }
        }

        ThemeService.Changed += SyncPanelTheme;
        flyout.Closed += (_, _) => ThemeService.Changed -= SyncPanelTheme;
        SyncPanelTheme();
        flyout.ShowAt((FrameworkElement)sender);
    }

    /// <summary>W7-F：分类 Chip（替代原下拉框）。Tag 为 null 表示「全部」。</summary>
    private void OnTagChipClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string tag })
        {
            ViewModel.SelectTag(tag);
        }
        else
        {
            ViewModel.SelectTag(null);
        }
    }

    private void OnEditClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: VaultItemViewModel vm })
        {
            ViewModel.OpenEditor(vm);
            _ = ShowEditorDialogAsync();
        }
    }

    private void OnDeleteClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: VaultItemViewModel vm })
        {
            ViewModel.RequestDelete(vm);
            _ = ShowDeleteDialogAsync();
        }
    }

    // ---- 工具栏 ----

    private void OnAddNewClick(object sender, RoutedEventArgs e)
    {
        ViewModel.OpenNewEditor();
        _ = ShowEditorDialogAsync();
    }

    private void OnTagSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: TagOption option })
        {
            ViewModel.SelectTag(option.Tag);
        }
    }

    private void OnTagRenameClick(object sender, RoutedEventArgs e)
    {
        ViewModel.OpenTagRename();
        _ = ShowTagRenameDialogAsync();
    }

    private void OnTagDeleteClick(object sender, RoutedEventArgs e)
    {
        ViewModel.OpenTagDelete();
        _ = ShowTagDeleteDialogAsync();
    }

    private void OnConflictBannerClick(object sender, RoutedEventArgs e)
    {
        _ = ShowConflictDialogAsync();
    }

    /// <summary>W7-F：「安全」入口改为**独立页面**（原为 ContentDialog；返回时本页会重新 LoadAsync）。</summary>
    private void OnSecurityClick(object sender, RoutedEventArgs e)
    {
        Frame.Navigate(typeof(PanelPage), "security");
    }

    /// <summary>W7-F：「管理」入口（仅 role=admin）改为**独立页面**。</summary>
    private void OnAdminClick(object sender, RoutedEventArgs e)
    {
        Frame.Navigate(typeof(PanelPage), "admin");
    }

    // ---- 对话框（每次新建实例） ----

    private async Task ShowEditorDialogAsync()
    {
        var dialog = new ContentDialog
        {
            // 弹窗不继承内容根的 RequestedTheme，必须显式跟随，否则深色皮肤下弹窗仍是浅色
            RequestedTheme = ThemeService.CurrentElementTheme,
            XamlRoot = XamlRoot,
            Title = ViewModel.EditorTitle,
            PrimaryButtonText = "保存",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
            IsPrimaryButtonEnabled = ViewModel.EditorSaveEnabled,
            Content = new EditorFormControl(ViewModel),
        };
        dialog.PrimaryButtonClick += OnEditorPrimaryClick;
        await dialog.ShowAsync();
    }

    private async void OnEditorPrimaryClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        bool ok = await ViewModel.SubmitEditorAsync();
        if (ok)
        {
            sender.Hide();
        }
        else
        {
            args.Cancel = true; // 保留对话框与表单输入
        }
        deferral.Complete();
    }

    private async Task ShowDeleteDialogAsync()
    {
        if (ViewModel.DeleteTarget is not { } target) return;
        var dialog = new ContentDialog
        {
            // 弹窗不继承内容根的 RequestedTheme，必须显式跟随，否则深色皮肤下弹窗仍是浅色
            RequestedTheme = ThemeService.CurrentElementTheme,
            XamlRoot = XamlRoot,
            Title = "删除密钥",
            Content = $"确定删除「{target.Site}」吗？此操作不可恢复。",
            PrimaryButtonText = "删除",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
        };
        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            bool ok = await ViewModel.ConfirmDeleteAsync();
            if (ok) { /* 页面已隐藏由 VM 刷新 */ }
            deferral.Complete();
        };
        await dialog.ShowAsync();
        ViewModel.DismissDelete();
    }

    private async Task ShowTagRenameDialogAsync()
    {
        if (ViewModel.ActiveTag is null) return;
        var textBox = new TextBox
        {
            Header = "新分类名称",
            Text = ViewModel.TagRenameText,
            MinWidth = 320,
        };
        var dialog = new ContentDialog
        {
            // 弹窗不继承内容根的 RequestedTheme，必须显式跟随，否则深色皮肤下弹窗仍是浅色
            RequestedTheme = ThemeService.CurrentElementTheme,
            XamlRoot = XamlRoot,
            Title = "重命名分类",
            Content = textBox,
            PrimaryButtonText = "重命名",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
        };
        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            ViewModel.TagRenameText = textBox.Text;
            bool ok = await ViewModel.ConfirmTagRenameAsync();
            if (!ok) args.Cancel = true;
            deferral.Complete();
        };
        await dialog.ShowAsync();
        ViewModel.CloseTagRename();
    }

    private async Task ShowTagDeleteDialogAsync()
    {
        if (ViewModel.TagDeleteName is not { } name) return;
        var dialog = new ContentDialog
        {
            // 弹窗不继承内容根的 RequestedTheme，必须显式跟随，否则深色皮肤下弹窗仍是浅色
            RequestedTheme = ThemeService.CurrentElementTheme,
            XamlRoot = XamlRoot,
            Title = "删除分类",
            Content = $"将从 {ViewModel.TagDeleteCount} 条密钥的分类中移除「{name}」。（分类为空时整键省略）",
            PrimaryButtonText = "删除",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
        };
        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            bool ok = await ViewModel.ConfirmTagDeleteAsync();
            if (!ok) args.Cancel = true;
            deferral.Complete();
        };
        await dialog.ShowAsync();
    }

    private async Task ShowConflictDialogAsync()
    {
        if (ViewModel.PendingConflicts.Count == 0) return;
        var stack = new StackPanel { Spacing = 8, MinWidth = 380 };
        stack.Children.Add(new TextBlock
        {
            Text = "以下条目在两边都有修改，请选择整体处理方式：",
            TextWrapping = TextWrapping.Wrap,
        });
        foreach (var cf in ViewModel.PendingConflicts)
        {
            stack.Children.Add(new TextBlock
            {
                Text = $"「{cf.Site}」 本机 {cf.LocalUpdatedAt} → 服务端 {cf.RemoteUpdatedAt}",
                FontSize = 12,
                Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Gray),
                TextWrapping = TextWrapping.Wrap,
            });
        }

        var dialog = new ContentDialog
        {
            // 弹窗不继承内容根的 RequestedTheme，必须显式跟随，否则深色皮肤下弹窗仍是浅色
            RequestedTheme = ThemeService.CurrentElementTheme,
            XamlRoot = XamlRoot,
            Title = "同步冲突",
            Content = stack,
            PrimaryButtonText = "保留本机",
            SecondaryButtonText = "用服务端",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
        };
        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            await ViewModel.ResolveConflictsAsync(useRemote: false);
            deferral.Complete();
        };
        dialog.SecondaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            await ViewModel.ResolveConflictsAsync(useRemote: true);
            deferral.Complete();
        };
        await dialog.ShowAsync();
    }

    private void OnLogoutRequested()
    {
        AppServices.SignOutAndGoLogin();
    }

    /// <summary>
    /// ② 卡片列宽自适应：让每行列数按可用宽度算，并让卡片**填满整行**
    /// （原先固定 ItemWidth=380，窗口宽度不是 380 的整数倍时右侧会留一大截空白）。
    /// 卡片自身有 Margin=7，所以可视间距 = 14，槽宽按 avail/cols 均分即可严丝合缝。
    /// </summary>
    private void OnCardListSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is not ListView { ItemsPanelRoot: ItemsWrapGrid grid })
        {
            return;
        }

        const double minCard = 336; // 卡片最小可用宽度（≈ 380 槽 − 14 边距 − 内边距余量）
        const double gap = 14;      // 卡片左右外边距合计
        double avail = Math.Max(minCard, e.NewSize.Width - 24); // 减去 ListView 左右 Padding 各 12

        int cols = Math.Max(1, (int)Math.Floor((avail + gap) / (minCard + gap)));
        double slot = Math.Floor(avail / cols);
        if (Math.Abs(grid.ItemWidth - slot) > 0.5)
        {
            grid.ItemWidth = slot;
        }
    }

    /// <summary>
    /// 图一：分类下拉菜单。每次点击按当前 TagOptions（含条目数）重建 MenuFlyout，
    /// 选中项用 ToggleMenuFlyoutItem 打勾；条目本身复用 OnTagChipClick（Tag=null 即「全部」）。
    /// </summary>
    private void OnTagDropdownClick(object sender, RoutedEventArgs e)
    {
        if (sender is not DropDownButton button)
        {
            return;
        }

        var flyout = new MenuFlyout();
        foreach (TagOption option in ViewModel.TagOptions)
        {
            var item = new ToggleMenuFlyoutItem
            {
                Text = option.Display,
                IsChecked = string.Equals(option.Tag, ViewModel.ActiveTag, StringComparison.Ordinal),
                Tag = option.Tag,
            };
            item.Click += OnTagChipClick;
            flyout.Items.Add(item);
        }

        flyout.ShowAt(button);
    }

    // W7-F/G：顶栏改用 XAML 声明（外观按钮 + 账户菜单），不再用代码挂载按钮。
}
