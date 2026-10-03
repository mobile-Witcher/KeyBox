using KeyBox.App.Controls;
using KeyBox.App.Services;
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

    /// <summary>「安全」入口：ContentDialog 承载安全面板（每次新建实例；数据变化后刷新列表）。</summary>
    private async void OnSecurityClick(object sender, RoutedEventArgs e)
    {
        var vm = new SecurityViewModel(AppServices.SecurityService, AppServices.CurrentUid);
        vm.DataChanged += () => _ = ViewModel.LoadAsync();
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = "安全",
            CloseButtonText = "关闭",
            Content = new SecurityPanelControl(vm),
        };
        _ = vm.InitializeAsync();
        await dialog.ShowAsync();
    }

    /// <summary>「管理」入口（仅 role=admin 可见）：ContentDialog 承载管理后台面板。</summary>
    private async void OnAdminClick(object sender, RoutedEventArgs e)
    {
        var vm = new AdminViewModel(AppServices.AdminService, AppServices.CurrentUid);
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = "管理",
            CloseButtonText = "关闭",
            Content = new AdminPanelControl(vm),
        };
        _ = vm.InitializeAsync();
        await dialog.ShowAsync();
    }

    // ---- 对话框（每次新建实例） ----

    private async Task ShowEditorDialogAsync()
    {
        var dialog = new ContentDialog
        {
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
}
