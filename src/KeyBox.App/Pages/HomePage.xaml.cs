using KeyBox.App.Services;
using KeyBox.App.ViewModels;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace KeyBox.App.Pages;

/// <summary>占位主窗口：显示已登录 + uid + 退出（W2 提供密钥列表）。</summary>
public sealed partial class HomePage : Page
{
    public HomeViewModel ViewModel { get; }

    public HomePage()
    {
        ViewModel = new HomeViewModel(AppServices.SessionManager);
        ViewModel.LogoutRequested += OnLogoutRequested;
        InitializeComponent();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        ViewModel.LoadSession();
    }

    private void OnLogoutRequested()
    {
        AppServices.NavigateToLogin();
    }
}
