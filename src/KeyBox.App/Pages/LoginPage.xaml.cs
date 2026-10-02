using KeyBox.App.Services;
using KeyBox.App.ViewModels;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace KeyBox.App.Pages;

/// <summary>手机号验证码登录页：发送（60s 倒计时）/ 校验 / 登录。</summary>
public sealed partial class LoginPage : Page
{
    public LoginViewModel ViewModel { get; }

    private readonly DispatcherTimer _countdownTimer;

    public LoginPage()
    {
        ViewModel = new LoginViewModel(AppServices.SessionManager);
        ViewModel.LoginSucceeded += OnLoginSucceeded;
        ViewModel.CountdownStarted += OnCountdownStarted;
        InitializeComponent();

        _countdownTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _countdownTimer.Tick += (_, _) =>
        {
            ViewModel.TickCountdown();
            if (ViewModel.RemainingSeconds <= 0)
            {
                _countdownTimer.Stop();
            }
        };
    }

    private void OnCountdownStarted()
    {
        _countdownTimer.Stop();
        _countdownTimer.Start();
    }

    private void OnLoginSucceeded()
    {
        _countdownTimer.Stop();
        AppServices.NavigateToHome();
    }
}
