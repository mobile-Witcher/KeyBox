using KeyBox.App.Services;
using KeyBox.Core.Data;
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

        // R01/R03 门禁（**启动/会话恢复路径**）：会话存在 ≠ 账号可用。
        // 被停用/软删的账号、或从未激活的号码，都不该进解锁页
        // （否则现象就是"看起来登录成功，解锁时却报账号不存在"，真机踩过）。
        ActivationProbe probe = await AppServices.ActivationService.ProbeAsync();
        if (probe.IsBlocked)
        {
            AppServices.NavigateToBlocked(probe.Status == "deleted"
                ? "该账号已被删除，无法继续使用，请联系管理员。"
                : "该账号已被停用，请联系管理员。");
            return;
        }

        // Error 为空说明拿到了明确答复（未激活）；Error 非空多为网络/服务异常，
        // 此时不要把人推去激活页，交给解锁流程自己报错更准确。
        if (!probe.Activated && probe.Error.Length == 0)
        {
            AppServices.NavigateToActivate(probe.Initialized ?? true);
            return;
        }

        await ViewModel.InitializeAsync();
    }

    private void OnUnlockSucceeded()
    {
        AppServices.NavigateToVault();
    }
}
