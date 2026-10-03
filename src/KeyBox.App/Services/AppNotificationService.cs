using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;

namespace KeyBox.App.Services;

/// <summary>
/// 原生通知（Windows App SDK AppNotificationManager）：同步完成 / 有冲突待处理时提醒。
/// 未打包（无包标识/AUMID）时通知不可用，此处静默降级为无操作，绝不影响主流程。
/// MSIX 打包后具备包身份，通知即自动生效。
/// </summary>
public static class AppNotificationService
{
    private static bool _registered;
    private static bool _registerFailed;

    /// <summary>发送一条通知（title + body）。任何异常都静默忽略。</summary>
    public static void Notify(string title, string body)
    {
        try
        {
            if (!_registered && !_registerFailed)
            {
                AppNotificationManager.Default.Register();
                _registered = true;
            }

            // WindowsAppSDK 1.5 形态：AddText(string) + BuildNotification()
            AppNotification notification = new AppNotificationBuilder()
                .AddText(title)
                .AddText(body)
                .BuildNotification();
            AppNotificationManager.Default.Show(notification);
        }
        catch
        {
            // 无包身份 / 通知平台不可用：静默降级
            _registerFailed = true;
        }
    }

    /// <summary>同步完成通知（N 条更新 / M 处冲突）。</summary>
    public static void NotifySyncDone(int updates, int conflicts)
        => Notify(
            "KeyBox 同步完成",
            conflicts > 0
                ? $"{updates} 条更新 · {conflicts} 处冲突待处理"
                : $"{updates} 条更新");

    /// <summary>有冲突待处理提醒。</summary>
    public static void NotifyConflicts(int count)
        => Notify("KeyBox 同步冲突", $"{count} 处冲突待处理，请打开密钥库处理。");
}
