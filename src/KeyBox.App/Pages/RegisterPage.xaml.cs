using System;
using KeyBox.App.Services;
using KeyBox.App.ViewModels;
using KeyBox.Core.Data;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace KeyBox.App.Pages;

/// <summary>
/// 独立注册页（R01/R03）两步向导：
///   第 1 步 手机号验证码登录（平台层，**未注册的号码也能登录**）——直接复用 LoginViewModel；
///   第 2 步 邀请码（系统已有用户时必填）+ 主密码 → kbRegister / kbInitAdmin。
/// 为什么必须先登录：kbRegister 的 uid 由云函数从平台会话注入，没有会话就没有身份可开户。
/// </summary>
public sealed partial class RegisterPage : Page
{
    public LoginViewModel Login { get; }

    private bool _needsInviteCode = true;
    private bool _busy;

    public RegisterPage()
    {
        Login = new LoginViewModel(AppServices.SessionManager);
        Login.LoginSucceeded += OnLoggedIn;
        InitializeComponent();
    }

    private async void OnLoggedIn()
    {
        SetBusy(true);
        try
        {
            ActivationProbe probe = await AppServices.ActivationService.ProbeAsync();
            if (probe.Activated)
            {
                // 已经是激活账号：直接去解锁，不必再注册
                AppServices.NavigateToUnlock();
                return;
            }

            if (probe.IsBlocked)
            {
                AppServices.NavigateToBlocked(probe.Status == "deleted"
                    ? "该账号已被删除，无法继续使用，请联系管理员。"
                    : "该账号已被停用，请联系管理员。");
                return;
            }

            _needsInviteCode = probe.Initialized ?? true;
            InviteBox.Visibility = _needsInviteCode ? Visibility.Visible : Visibility.Collapsed;
            StepTwoHint.Text = _needsInviteCode
                ? "第 2 步：填写管理员给的一次性邀请码，并设置你的主密码。"
                : "第 2 步：系统尚无任何用户，你将成为首位管理员，请设置主密码。";
            StepOnePanel.Visibility = Visibility.Collapsed;
            StepTwoPanel.Visibility = Visibility.Visible;
            StatusText.Text = "手机号验证成功，请继续完成注册。";
        }
        catch (Exception ex)
        {
            StatusText.Text = "继续注册失败：" + ex.Message;
        }
        finally
        {
            SetBusy(false);
            UpdateSubmitState();
        }
    }

    private void OnPasswordChanged(object sender, RoutedEventArgs e) => UpdateSubmitState();

    private void OnConfirmChanged(object sender, RoutedEventArgs e) => UpdateSubmitState();

    private void UpdateSubmitState()
    {
        SubmitButton.IsEnabled = !_busy
            && PwdBox.Password.Length >= 8
            && PwdBox.Password == ConfirmBox.Password
            && (!_needsInviteCode || InviteBox.Text.Trim().Length > 0);
    }

    private async void OnSubmitClick(object sender, RoutedEventArgs e)
    {
        SetBusy(true);
        StatusText.Text = "";
        try
        {
            string error = await AppServices.ActivationService.ActivateAsync(
                _needsInviteCode ? InviteBox.Text : null, PwdBox.Password);
            if (error.Length > 0)
            {
                StatusText.Text = error;
                return;
            }

            StatusText.Text = "注册成功，请用刚设置的主密码解锁。";
            AppServices.NavigateToUnlock();
        }
        catch (Exception ex)
        {
            StatusText.Text = "注册失败：" + ex.Message;
        }
        finally
        {
            SetBusy(false);
            UpdateSubmitState();
        }
    }

    private void SetBusy(bool busy)
    {
        _busy = busy;
        BusyRing.IsActive = busy;
        BusyRing.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnBackClick(object sender, RoutedEventArgs e) => AppServices.SignOutAndGoLogin();
}