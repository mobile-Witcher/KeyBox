using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KeyBox.Core.Auth;
using Microsoft.UI.Xaml;

namespace KeyBox.App.ViewModels;

/// <summary>
/// 登录页 ViewModel：手机号 + 验证码（发送 / 60s 倒计时 / 登录）。
/// 倒计时由页面上的 DispatcherTimer 每秒调用 TickCountdown 驱动。
/// </summary>
public partial class LoginViewModel : ObservableObject
{
    private readonly SessionManager _sessionManager;
    private string? _verificationId;

    /// <summary>登录成功后触发（页面据此跳主窗口）。</summary>
    public event Action? LoginSucceeded;

    /// <summary>验证码已发送、倒计时开始时触发（页面据此启动定时器）。</summary>
    public event Action? CountdownStarted;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendCodeCommand))]
    [NotifyCanExecuteChangedFor(nameof(LoginCommand))]
    private string _phone = "";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendCodeCommand))]
    [NotifyCanExecuteChangedFor(nameof(LoginCommand))]
    private string _code = "";

    [ObservableProperty]
    private string _statusMessage = "";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendCodeCommand))]
    [NotifyCanExecuteChangedFor(nameof(LoginCommand))]
    [NotifyPropertyChangedFor(nameof(ProgressVisibility))]
    private bool _isBusy;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendCodeCommand))]
    [NotifyPropertyChangedFor(nameof(SendCodeButtonText))]
    private int _remainingSeconds;

    public LoginViewModel(SessionManager sessionManager)
    {
        _sessionManager = sessionManager;
    }

    /// <summary>发送按钮文案：倒计时期间显示剩余秒数。</summary>
    public string SendCodeButtonText => RemainingSeconds > 0 ? $"重新发送 ({RemainingSeconds}s)" : "发送验证码";

    public Visibility ProgressVisibility => IsBusy ? Visibility.Visible : Visibility.Collapsed;

    private bool CanSendCode => !IsBusy && RemainingSeconds <= 0 && !string.IsNullOrWhiteSpace(Phone);

    private bool CanLogin => !IsBusy && _verificationId is not null && !string.IsNullOrWhiteSpace(Code);

    [RelayCommand(CanExecute = nameof(CanSendCode))]
    private async Task SendCodeAsync()
    {
        IsBusy = true;
        StatusMessage = "正在发送验证码…";
        try
        {
            _verificationId = await _sessionManager.SendVerificationCodeAsync(Phone.Trim());
            LoginCommand.NotifyCanExecuteChanged();
            RemainingSeconds = 60;
            StatusMessage = "验证码已发送，请查收短信";
            CountdownStarted?.Invoke();
        }
        catch (Exception ex)
        {
            _verificationId = null;
            StatusMessage = "发送失败：" + ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand(CanExecute = nameof(CanLogin))]
    private async Task LoginAsync()
    {
        IsBusy = true;
        StatusMessage = "正在登录…";
        try
        {
            await _sessionManager.SignInWithCodeAsync(Phone.Trim(), _verificationId!, Code.Trim());
            StatusMessage = "登录成功";
            LoginSucceeded?.Invoke();
        }
        catch (Exception ex)
        {
            StatusMessage = "登录失败：" + ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>页面 DispatcherTimer 每秒调用；归零即停。</summary>
    public void TickCountdown()
    {
        if (RemainingSeconds > 0)
        {
            RemainingSeconds--;
        }
    }
}
