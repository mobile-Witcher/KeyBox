using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using KeyBox.Core.Admin;
using KeyBox.Core.Data;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;

namespace KeyBox.App.ViewModels;

/// <summary>二次确认类型（照鸿蒙 confirmMode / 安卓 AdminConfirmKind）。</summary>
public enum AdminConfirmKind
{
    None,
    RevokeInvite,
    DisableUser,
    DeleteUser,
}

/// <summary>待确认动作 + 目标用户（邀请码作废无目标用户）。</summary>
public sealed record AdminConfirm(AdminConfirmKind Kind, AdminUserItem? Row = null);

/// <summary>管理后台用户列表渲染项（白名单字段；照安卓 AdminUserItem）。</summary>
public sealed class AdminUserItem
{
    public AdminUserRow Row { get; }

    /// <summary>是否当前登录管理员自己（防呆：自己那行不渲染停用/删除按钮）。</summary>
    public bool IsSelfUser { get; init; }

    public AdminUserItem(AdminUserRow row)
    {
        Row = row;
    }

    public string Uid => Row.Uid;

    public int ItemCount => Row.ItemCount;

    /// <summary>自己那行不渲染操作按钮（仅显示）。</summary>
    public Visibility ActionsVisibility => IsSelfUser ? Visibility.Collapsed : Visibility.Visible;

    /// <summary>停用/启用按钮文案（active=停用，其余=启用）。</summary>
    public string StatusActionText => IsActive ? "停用" : "启用";

    /// <summary>显示名兜底（空名显示「（未命名）」）。</summary>
    public string DisplayName => Row.Username.Length > 0 ? Row.Username : "（未命名）";

    /// <summary>状态胶囊文案（active/deleted/其他=已停用）。</summary>
    public string StatusText => Row.Status switch
    {
        "active" => "正常",
        "deleted" => "已删除",
        _ => "已停用",
    };

    public bool IsActive => Row.Status == "active";

    /// <summary>状态胶囊颜色：正常绿 / 已删除灰 / 已停用琥珀。</summary>
    public Brush StatusBrush => Row.Status switch
    {
        "active" => new SolidColorBrush(Microsoft.UI.Colors.MediumSeaGreen),
        "deleted" => new SolidColorBrush(Microsoft.UI.Colors.Gray),
        _ => new SolidColorBrush(Microsoft.UI.Colors.DarkOrange),
    };

    /// <summary>注册时间格式化（解析失败原样；空显示「—」）。</summary>
    public string CreatedAtText
    {
        get
        {
            if (Row.CreatedAt.Length == 0) return "—";
            return DateTimeOffset.TryParse(Row.CreatedAt, out DateTimeOffset t)
                ? t.ToLocalTime().ToString("yyyy-MM-dd HH:mm")
                : Row.CreatedAt;
        }
    }
}

/// <summary>
/// 管理后台 ViewModel（照安卓 AdminViewModel / 鸿蒙 Admin.ets 语义移植）：
///   R02 邀请码——生成（展示一次）/ 复制（30 秒自动清空剪贴板，R25 同语义）/ 作废（二次确认）。
///   R12 用户列表——直连 RPC kb_admin_user_list；白名单字段渲染。
///   R13 停用/启用——直连 PATCH kb_users 单列 status；停用需二次确认，启用直接执行。
///   R14 删除数据——云函数 kbAdminDeleteUserData；二次确认含条目数与不可撤销警示。
/// 界面纪律：全页无「查看密钥」入口；底栏常驻管理员免责声明。
/// </summary>
public partial class AdminViewModel : ObservableObject
{
    private const int CopyGuardSeconds = 30;

    private readonly AdminService _admin;
    private readonly string? _myUid;
    private CancellationTokenSource? _copyCts;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CountText))]
    [NotifyPropertyChangedFor(nameof(ConfirmVisibility))]
    [NotifyPropertyChangedFor(nameof(ConfirmText))]
    [NotifyPropertyChangedFor(nameof(IsFull))]
    [NotifyPropertyChangedFor(nameof(FullBannerVisibility))]
    [NotifyPropertyChangedFor(nameof(CanGenerateInvite))]
    private ObservableCollection<AdminUserItem> _users = new();

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(LoadingVisibility))]
    private bool _isLoading;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IdleEnabled))]
    [NotifyPropertyChangedFor(nameof(CanGenerateInvite))]
    [NotifyPropertyChangedFor(nameof(CanRevokeInvite))]
    private bool _isBusy;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(StatusBrush))]
    private string _statusMessage = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(StatusBrush))]
    private bool _statusIsError;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(InviteCodeVisibility))]
    [NotifyPropertyChangedFor(nameof(CanRevokeInvite))]
    private string _inviteCode = "";

    /// <summary>邀请码复制护栏倒计时（秒），&gt;0 表示剪贴板持有邀请码。</summary>
    [ObservableProperty]
    private int _copyCountdown;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ConfirmVisibility))]
    [NotifyPropertyChangedFor(nameof(ConfirmText))]
    private AdminConfirm? _pendingConfirm;

    public AdminViewModel(AdminService admin, string? myUid)
    {
        _admin = admin;
        _myUid = myUid;
    }

    // ---- 展示辅助 ----

    public int UserLimit => AdminService.UserLimit;

    public string CountText => $"已开户 {Users.Count} / 上限 {UserLimit}";

    public bool IsFull => Users.Count >= UserLimit;

    public bool IdleEnabled => !IsBusy && !IsLoading;

    public bool CanGenerateInvite => !IsFull && !IsBusy;

    public bool CanRevokeInvite => InviteCode.Length > 0 && !IsBusy;

    public Visibility LoadingVisibility => IsLoading ? Visibility.Visible : Visibility.Collapsed;

    public Visibility FullBannerVisibility => IsFull ? Visibility.Visible : Visibility.Collapsed;

    public Visibility InviteCodeVisibility => InviteCode.Length > 0 ? Visibility.Visible : Visibility.Collapsed;

    public Visibility ConfirmVisibility => PendingConfirm is not null ? Visibility.Visible : Visibility.Collapsed;

    public Brush StatusBrush => StatusIsError
        ? new SolidColorBrush(Microsoft.UI.Colors.OrangeRed)
        : new SolidColorBrush(Microsoft.UI.Colors.Gray);

    /// <summary>内联确认区文案（避免嵌套 ContentDialog）。</summary>
    public string ConfirmText => PendingConfirm?.Kind switch
    {
        AdminConfirmKind.RevokeInvite => "确定作废这个邀请码？作废后该码立即失效，无法再用于开户。",
        AdminConfirmKind.DisableUser =>
            $"确定停用用户「{PendingConfirm.Row?.DisplayName}」？停用后其会话将在 ≤1 分钟内失效，该用户无法再登录。",
        AdminConfirmKind.DeleteUser =>
            $"确定删除用户「{PendingConfirm.Row?.DisplayName}」的全部 {PendingConfirm.Row?.ItemCount} 条密钥数据？\n\n此操作不可撤销，且该用户将被置为 deleted。",
        _ => "",
    };

    /// <summary>某人是否为当前登录管理员自己（防呆：自己那行不渲染停用/删除按钮）。</summary>
    public bool IsSelf(string uid) => !string.IsNullOrEmpty(_myUid) && uid == _myUid;

    // ---- R12 用户列表 ----

    public async Task InitializeAsync()
    {
        await ReloadAsync();
    }

    public async Task ReloadAsync()
    {
        IsBusy = true;
        IsLoading = true;
        StatusMessage = "";
        try
        {
            List<AdminUserRow> rows = await _admin.ListUsersAsync();
            Users = new ObservableCollection<AdminUserItem>(
                rows.Select(r => new AdminUserItem(r) { IsSelfUser = IsSelf(r.Uid) }));
        }
        catch (Exception ex)
        {
            StatusMessage = "加载用户列表失败：" + ex.Message;
            StatusIsError = true;
        }
        finally
        {
            IsLoading = false;
            IsBusy = false;
        }
    }

    // ---- R02 邀请码 ----

    public async Task CreateInviteAsync()
    {
        if (IsBusy || IsFull) return;
        IsBusy = true;
        StatusMessage = "";
        try
        {
            KbInvite invite = await _admin.CreateInviteAsync();
            InviteCode = invite.Code;
            StatusMessage = "已生成一次性邀请码，复制后发给新同事（用一次即失效）。";
            StatusIsError = false;
        }
        catch (Exception ex)
        {
            StatusMessage = "生成邀请码失败：" + ex.Message;
            StatusIsError = true;
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>复制邀请码 + 30 秒自动清空剪贴板（R25 护栏，重复复制重置倒计时）。</summary>
    public void CopyInvite()
    {
        if (InviteCode.Length == 0) return;

        var package = new DataPackage();
        package.SetText(InviteCode);
        Clipboard.SetContent(package);
        Clipboard.Flush();

        _copyCts?.Cancel();
        _copyCts = new CancellationTokenSource();
        CancellationToken token = _copyCts.Token;
        _ = RunCopyCountdownAsync(token);
    }

    private async Task RunCopyCountdownAsync(CancellationToken token)
    {
        for (int left = CopyGuardSeconds; left >= 1; left--)
        {
            CopyCountdown = left;
            StatusMessage = $"已复制邀请码，{left} 秒后自动清空剪贴板";
            StatusIsError = false;
            try
            {
                await Task.Delay(1000, token);
            }
            catch (TaskCanceledException)
            {
                return;
            }
        }

        var clearPackage = new DataPackage();
        clearPackage.SetText("");
        Clipboard.SetContent(clearPackage);
        Clipboard.Flush();

        CopyCountdown = 0;
        StatusMessage = "剪贴板已自动清空";
    }

    public void RequestRevokeInvite()
    {
        if (InviteCode.Length == 0 || IsBusy) return;
        PendingConfirm = new AdminConfirm(AdminConfirmKind.RevokeInvite);
    }

    // ---- R13 停用 / 启用 ----

    /// <summary>active→disabled 需二次确认；否则（启用）直接执行。防呆：自己那行忽略。</summary>
    public void ToggleStatus(AdminUserItem row)
    {
        if (IsBusy || row is null || IsSelf(row.Uid)) return;
        if (row.IsActive)
        {
            PendingConfirm = new AdminConfirm(AdminConfirmKind.DisableUser, row);
        }
        else
        {
            _ = ApplyStatusAsync(row, "active");
        }
    }

    private async Task ApplyStatusAsync(AdminUserItem row, string next)
    {
        string verb = next == "disabled" ? "停用" : "启用";
        IsBusy = true;
        StatusMessage = "";
        try
        {
            await _admin.SetUserStatusAsync(row.Uid, next);
            StatusMessage = $"已{verb}用户「{row.DisplayName}」。";
            StatusIsError = false;
        }
        catch (Exception ex)
        {
            StatusMessage = "更新用户状态失败：" + ex.Message;
            StatusIsError = true;
        }
        finally
        {
            IsBusy = false;
        }
        await ReloadAsync();
    }

    // ---- R14 删除用户数据 ----

    public void RequestDelete(AdminUserItem row)
    {
        if (IsBusy || row is null || IsSelf(row.Uid)) return;
        PendingConfirm = new AdminConfirm(AdminConfirmKind.DeleteUser, row);
    }

    public void DismissConfirm()
    {
        PendingConfirm = null;
    }

    /// <summary>执行待确认动作（按类型分派）。</summary>
    public async Task ConfirmExecuteAsync()
    {
        AdminConfirm? pending = PendingConfirm;
        if (pending is null || IsBusy) return;
        PendingConfirm = null;

        switch (pending.Kind)
        {
            case AdminConfirmKind.RevokeInvite:
                IsBusy = true;
                try
                {
                    await _admin.RevokeInviteAsync(InviteCode);
                    InviteCode = "";
                    StatusMessage = "邀请码已作废。";
                    StatusIsError = false;
                }
                catch (Exception ex)
                {
                    StatusMessage = "作废邀请码失败：" + ex.Message;
                    StatusIsError = true;
                }
                finally
                {
                    IsBusy = false;
                }
                break;

            case AdminConfirmKind.DisableUser:
                if (pending.Row is not null) await ApplyStatusAsync(pending.Row, "disabled");
                break;

            case AdminConfirmKind.DeleteUser:
                if (pending.Row is not null) await DeleteUserDataAsync(pending.Row);
                break;
        }
    }

    private async Task DeleteUserDataAsync(AdminUserItem row)
    {
        IsBusy = true;
        StatusMessage = "";
        try
        {
            int deletedCount = await _admin.DeleteUserDataAsync(row.Uid);
            StatusMessage = $"已删除用户「{row.DisplayName}」的 {deletedCount} 条记录，该用户已置为 deleted。";
            StatusIsError = false;
        }
        catch (Exception ex)
        {
            // 服务端自检错误（如 CANNOT_DELETE_SELF）原样展示
            StatusMessage = "删除用户数据失败：" + ex.Message;
            StatusIsError = true;
        }
        finally
        {
            IsBusy = false;
        }
        await ReloadAsync();
    }
}
