using System;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KeyBox.Core.Vault;
using Microsoft.UI.Xaml;

namespace KeyBox.App.ViewModels;

/// <summary>
/// R01/R03 激活页 VM：首次初始化（系统无用户，kbInitAdmin）或邀请码激活（kbRegister）。
/// 只提交 kdf_salt / kdf_verifier，主密码与主密钥不出本进程。
/// </summary>
public partial class ActivateViewModel : ObservableObject
{
    private readonly ActivationService _activation;

    public ActivateViewModel(ActivationService activation, bool systemHasUsers)
    {
        _activation = activation;
        SystemHasUsers = systemHasUsers;
    }

    /// <summary>true=系统已有用户（必须填邀请码）；false=系统还没有用户（首次初始化）。</summary>
    public bool SystemHasUsers { get; }

    public bool NeedsInviteCode => SystemHasUsers;

    public string Title => SystemHasUsers ? "邀请码激活" : "首次初始化";

    public string Hint => SystemHasUsers
        ? "请向管理员索取一次性邀请码（用一次即失效）。激活后请用刚设置的主密码解锁。"
        : "系统尚无任何用户，你将成为首位管理员。主密码用于派生密钥、忘记无法找回，请妥善保存。";

    public Visibility InviteCodeVisibility => NeedsInviteCode ? Visibility.Visible : Visibility.Collapsed;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SubmitCommand))]
    private string _inviteCode = "";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SubmitCommand))]
    private string _password = "";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SubmitCommand))]
    private string _confirm = "";

    [ObservableProperty]
    private string _statusMessage = "";

    [ObservableProperty]
    private bool _statusIsError;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SubmitCommand))]
    private bool _isBusy;

    public Visibility BusyVisibility => IsBusy ? Visibility.Visible : Visibility.Collapsed;

    public bool CanSubmit => !IsBusy
        && Password.Length >= 8
        && Password == Confirm
        && (!NeedsInviteCode || InviteCode.Trim().Length > 0);

    /// <summary>激活成功（由页面跳去解锁页）。</summary>
    public event Action? Activated;

    [RelayCommand(CanExecute = nameof(CanSubmit))]
    private async Task SubmitAsync()
    {
        IsBusy = true;
        StatusMessage = "";
        StatusIsError = false;
        try
        {
            string error = await _activation.ActivateAsync(NeedsInviteCode ? InviteCode : null, Password);
            if (error.Length > 0)
            {
                StatusMessage = error;
                StatusIsError = true;
                return;
            }

            Activated?.Invoke();
        }
        catch (Exception ex)
        {
            StatusMessage = "激活失败：" + ex.Message;
            StatusIsError = true;
        }
        finally
        {
            IsBusy = false;
        }
    }
}