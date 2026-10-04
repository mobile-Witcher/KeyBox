using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KeyBox.Core.Vault;
using KeyBox.App.Services;
using Microsoft.UI.Xaml;

namespace KeyBox.App.ViewModels;

/// <summary>
/// 解锁页 ViewModel：Windows Hello 优先（有包裹物且可用时自动弹验证），失败/不可用降级主密码。
/// 首次主密码解锁成功后引导「启用 Windows Hello 解锁」（本批亮点）。
/// </summary>
public partial class UnlockViewModel : ObservableObject
{
    private readonly UnlockService _unlock;
    private readonly HelloAuthService _hello;
    private readonly string? _uid;
    private bool _autoPromptedHello;

    /// <summary>解锁成功（进入密钥库）。</summary>
    public event Action? UnlockSucceeded;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(UnlockCommand))]
    private string _password = "";

    [ObservableProperty]
    private string _statusMessage = "";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(UnlockCommand))]
    [NotifyPropertyChangedFor(nameof(HelloButtonVisibility))]
    [NotifyPropertyChangedFor(nameof(BusyVisibility))]
    private bool _isBusy;

    [ObservableProperty]
    private bool _isHelloAvailable;

    [ObservableProperty]
    private bool _isHelloEnabled;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(EnableHelloPanelVisibility))]
    private bool _showEnableHelloPanel;

    [ObservableProperty]
    private string _uidText = "";

    public UnlockViewModel(UnlockService unlock, HelloAuthService hello, string? uid)
    {
        _unlock = unlock;
        _hello = hello;
        _uid = uid;
        UidText = string.IsNullOrEmpty(uid) ? "" : "账号：" + uid;
    }

    public Visibility HelloButtonVisibility =>
        IsHelloAvailable && IsHelloEnabled && !IsBusy ? Visibility.Visible : Visibility.Collapsed;

    public Visibility BusyVisibility => IsBusy ? Visibility.Visible : Visibility.Collapsed;

    public Visibility EnableHelloPanelVisibility =>
        ShowEnableHelloPanel ? Visibility.Visible : Visibility.Collapsed;

    private bool CanUnlock => !IsBusy && !string.IsNullOrWhiteSpace(Password);

    /// <summary>页面加载：探测 Hello 可用性，有包裹物则自动弹验证。</summary>
    public async Task InitializeAsync()
    {
        IsHelloAvailable = await _hello.IsAvailableAsync();
        IsHelloEnabled = _hello.HasWrapper;

        if (IsHelloAvailable && IsHelloEnabled && !string.IsNullOrEmpty(_uid) && !_autoPromptedHello)
        {
            _autoPromptedHello = true;
            await TryHelloUnlockAsync();
        }
    }

    /// <summary>手动触发 Windows Hello 解锁（自动弹验证失败后的重试入口）。</summary>
    [RelayCommand]
    private async Task HelloUnlockAsync()
    {
        await TryHelloUnlockAsync();
    }

    private async Task TryHelloUnlockAsync()
    {
        if (string.IsNullOrEmpty(_uid)) return;
        IsBusy = true;
        StatusMessage = "请完成 Windows Hello 验证…";
        try
        {
            bool ok = await _hello.TryUnlockAsync(_uid);
            if (ok)
            {
                StatusMessage = "Windows Hello 解锁成功";
                UnlockSucceeded?.Invoke();
                return;
            }
            IsHelloEnabled = _hello.HasWrapper;
            StatusMessage = "Windows Hello 验证未通过，请使用主密码解锁";
        }
        catch (Exception ex)
        {
            StatusMessage = "Windows Hello 解锁失败：" + ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>主密码解锁：拉 KeyInfo → 派生校验 → 写内存单例；失败仅提示「主密码错误」。</summary>
    [RelayCommand(CanExecute = nameof(CanUnlock))]
    private async Task UnlockAsync()
    {
        if (string.IsNullOrEmpty(_uid))
        {
            StatusMessage = "登录态缺失，请重新登录";
            return;
        }

        IsBusy = true;
        StatusMessage = "正在解锁…";
        try
        {
            await _unlock.UnlockWithPasswordAsync(_uid, Password);
            StatusMessage = "解锁成功";
            IsHelloEnabled = _hello.HasWrapper;
            ShowEnableHelloPanel = IsHelloAvailable && !IsHelloEnabled;
            if (!ShowEnableHelloPanel)
            {
                UnlockSucceeded?.Invoke();
            }
        }
        catch (UnlockException)
        {
            StatusMessage = "主密码错误";
        }
        catch (Exception ex)
        {
            StatusMessage = "解锁失败：" + ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>启用 Windows Hello 解锁：系统验证通过 → DPAPI 包裹 masterKey → hello.bin → 进密钥库。</summary>
    [RelayCommand]
    private async Task EnableHelloAsync()
    {
        byte[]? raw = MasterKeySession.MasterKeyRaw();
        if (raw is null)
        {
            StatusMessage = "主密钥未在内存，请重新解锁";
            return;
        }

        IsBusy = true;
        try
        {
            bool ok = await _hello.EnableAsync(raw);
            if (ok)
            {
                IsHelloEnabled = true;
                ShowEnableHelloPanel = false;
                StatusMessage = "已启用 Windows Hello 解锁";
                UnlockSucceeded?.Invoke();
            }
            else
            {
                StatusMessage = "未启用：Windows Hello 验证未通过";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = "启用失败：" + ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>暂不启用 Windows Hello，直接进密钥库。</summary>
    [RelayCommand]
    private void SkipHello()
    {
        ShowEnableHelloPanel = false;
        UnlockSucceeded?.Invoke();
    }
}
