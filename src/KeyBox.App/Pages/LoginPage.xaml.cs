using KeyBox.App.Services;
using KeyBox.Core.Data;
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

    private async void OnLoginSucceeded()
    {
        _countdownTimer.Stop();

        // R01/R03 门禁：平台手机号登录成功 ≠ 已开户。必须先问云函数本账号是否已激活，
        // 否则未激活的号会被放进解锁页（看起来"登录成功"，实际取不到密钥参数），
        // 而拿到邀请码的新同事也无法在原生端完成开户。
        ActivationProbe probe = await AppServices.ActivationService.ProbeAsync();
        if (probe.Activated)
        {
            AppServices.NavigateToUnlock();
            return;
        }

        // initialized=false → 系统还没有任何用户 → 首次初始化；其余（true/未知）→ 邀请码激活
        AppServices.NavigateToActivate(probe.Initialized ?? true);
    }
}
