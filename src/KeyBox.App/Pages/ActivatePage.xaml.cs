using KeyBox.App.Services;
using KeyBox.App.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace KeyBox.App.Pages;

/// <summary>
/// R01/R03 激活页：首次初始化（系统无用户）或邀请码激活；成功后进解锁页用新主密码解锁。
/// </summary>
public sealed partial class ActivatePage : Page
{
    public ActivateViewModel ViewModel { get; }

    public ActivatePage()
    {
        ViewModel = new ActivateViewModel(AppServices.ActivationService, AppServices.PendingSystemHasUsers);
        ViewModel.Activated += OnActivated;
        InitializeComponent();
    }

    private void OnPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (sender is PasswordBox box)
        {
            ViewModel.Password = box.Password;
        }
    }

    private void OnConfirmChanged(object sender, RoutedEventArgs e)
    {
        if (sender is PasswordBox box)
        {
            ViewModel.Confirm = box.Password;
        }
    }

    private void OnActivated()
    {
        AppServices.NavigateToUnlock();
    }
}