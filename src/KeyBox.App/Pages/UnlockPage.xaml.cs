using KeyBox.App.Services;
using KeyBox.App.ViewModels;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace KeyBox.App.Pages;

/// <summary>
/// 解锁页：Windows Hello 优先（有包裹物自动弹验证），失败/不可用降级主密码；
/// 首次主密码解锁成功后引导启用 Windows Hello。
/// </summary>
public sealed partial class UnlockPage : Page
{
    public UnlockViewModel ViewModel { get; }

    public UnlockPage()
    {
        ViewModel = new UnlockViewModel(
            AppServices.UnlockService,
            AppServices.HelloAuth,
            AppServices.CurrentUid);
        ViewModel.UnlockSucceeded += OnUnlockSucceeded;
        InitializeComponent();
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        await ViewModel.InitializeAsync();
    }

    private void OnUnlockSucceeded()
    {
        AppServices.NavigateToVault();
    }
}
