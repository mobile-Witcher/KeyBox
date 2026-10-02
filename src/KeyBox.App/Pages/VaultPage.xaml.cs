using KeyBox.App.Services;
using KeyBox.App.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace KeyBox.App.Pages;

/// <summary>
/// 密钥库页（只读）：解密渲染卡片 + 复制护栏（30 秒自动清空剪贴板）+ 按钮刷新。
/// W2 只读；编辑/删除/新增留到 W3。
/// </summary>
public sealed partial class VaultPage : Page
{
    public VaultViewModel ViewModel { get; }

    public VaultPage()
    {
        ViewModel = new VaultViewModel(AppServices.VaultService, AppServices.CurrentUid);
        ViewModel.LogoutRequested += OnLogoutRequested;
        InitializeComponent();
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        await ViewModel.LoadAsync();
    }

    private void OnCopyClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: VaultItemViewModel vm })
        {
            ViewModel.CopyKeyCommand.Execute(vm);
        }
    }

    private void OnLogoutRequested()
    {
        AppServices.SignOutAndGoLogin();
    }
}
