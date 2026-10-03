using KeyBox.App.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace KeyBox.App.Controls;

/// <summary>
/// 管理后台面板（ContentDialog 承载）：R02 邀请码 / R12 用户列表 / R13 停用启用 / R14 删除数据。
/// 二次确认区为内联（避免 WinUI 嵌套 ContentDialog 限制）；卡片按钮在代码里按 DataContext 分派。
/// </summary>
public sealed partial class AdminPanelControl : UserControl
{
    public AdminViewModel ViewModel { get; }

    public AdminPanelControl(AdminViewModel viewModel)
    {
        ViewModel = viewModel;
        InitializeComponent();
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e)
    {
        _ = ViewModel.ReloadAsync();
    }

    // ---- R02 邀请码 ----

    private void OnCreateInviteClick(object sender, RoutedEventArgs e)
    {
        _ = ViewModel.CreateInviteAsync();
    }

    private void OnCopyInviteClick(object sender, RoutedEventArgs e)
    {
        ViewModel.CopyInvite();
    }

    private void OnRevokeInviteClick(object sender, RoutedEventArgs e)
    {
        ViewModel.RequestRevokeInvite();
    }

    // ---- R13 停用 / 启用 ----

    private void OnToggleStatusClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: AdminUserItem row })
        {
            ViewModel.ToggleStatus(row);
        }
    }

    // ---- R14 删除用户数据 ----

    private void OnDeleteClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: AdminUserItem row })
        {
            ViewModel.RequestDelete(row);
        }
    }

    // ---- 二次确认 ----

    private void OnConfirmClick(object sender, RoutedEventArgs e)
    {
        _ = ViewModel.ConfirmExecuteAsync();
    }

    private void OnConfirmCancelClick(object sender, RoutedEventArgs e)
    {
        ViewModel.DismissConfirm();
    }
}
