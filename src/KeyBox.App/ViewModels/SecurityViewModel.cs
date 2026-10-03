using CommunityToolkit.Mvvm.ComponentModel;
using KeyBox.App.Services;
using KeyBox.Core.Data;
using KeyBox.Core.Vault;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace KeyBox.App.ViewModels;

/// <summary>
/// 安全面板 ViewModel（照安卓 SecurityViewModel 语义移植）：
///   R21 改主密码（事务性在 Core SecurityService；成功后删 hello.bin）
///   R28 恢复码（kbGetMyRole 读状态 → 未确认 kbAckRecovery；无恢复码账号只显示说明，不提供生成）
///   R29 备份（导出明文 JSON / 导入逐条重加密上传）
/// 明文纪律：主密码/恢复码只在属性内存短暂存在，成功后立即清空。
/// </summary>
public partial class SecurityViewModel : ObservableObject
{
    /// <summary>改主密码确认必经文案（硬约束保留）。</summary>
    public const string ReloginConfirmText = "此操作会使所有设备（含本机）退出登录，需要重新用手机号验证登录。";
    public string ReloginConfirmLine => ReloginConfirmText;

    private readonly SecurityService _security;
    private readonly string? _uid;

    /// <summary>数据已变化（导入成功 / 改密成功），宿主应刷新密钥列表。</summary>
    public event Action? DataChanged;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IdleEnabled))]
    [NotifyPropertyChangedFor(nameof(LoadingVisibility))]
    private bool _isLoading = true;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IdleEnabled))]
    [NotifyPropertyChangedFor(nameof(BusyVisibility))]
    private bool _isBusy;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(StatusBrush))]
    private string _statusMessage = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(StatusBrush))]
    private bool _statusIsError;

    // ---- kbGetMyRole 返回 ----
    [ObservableProperty]
    private string _kdfSalt = "";

    [ObservableProperty]
    private string _kdfVerifier = "";

    [ObservableProperty]
    private int _roleKeyEpoch;

    [ObservableProperty]
    private string _recoverySalt = "";

    [ObservableProperty]
    private string _recoveryBlob = "";

    [ObservableProperty]
    private string _recoveryAckAt = "";

    // ---- R21 表单 ----
    [ObservableProperty]
    private string _oldPwd = "";

    [ObservableProperty]
    private string _newPwd = "";

    [ObservableProperty]
    private string _confirmPwd = "";

    [ObservableProperty]
    private string _recoveryCode = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(RotateConfirmVisibility))]
    private bool _showRotateConfirm;

    // ---- R29 导出（确认 → 暂存 JSON → 写盘） ----
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ExportConfirmVisibility))]
    private bool _showExportConfirm;

    [ObservableProperty]
    private string _pendingExportJson = "";

    [ObservableProperty]
    private int _pendingExportCount;

    [ObservableProperty]
    private int _pendingExportSkipped;

    public SecurityViewModel(SecurityService security, string? uid)
    {
        _security = security;
        _uid = uid;
    }

    // ---- 展示辅助 ----

    /// <summary>本账号是否已设恢复码（salt 与 blob 成对）。</summary>
    public bool HasRecovery => RecoverySalt.Length > 0 && RecoveryBlob.Length > 0;

    /// <summary>有恢复码但未确认抄下（面板常驻提醒）。</summary>
    public bool RecoveryUnacked => HasRecovery && RecoveryAckAt.Length == 0;

    public bool IdleEnabled => !IsBusy && !IsLoading;

    /// <summary>状态文案颜色：错误橙红，正常灰色。</summary>
    public Brush StatusBrush => StatusIsError
        ? new SolidColorBrush(Microsoft.UI.Colors.OrangeRed)
        : new SolidColorBrush(Microsoft.UI.Colors.Gray);

    public Visibility LoadingVisibility => IsLoading ? Visibility.Visible : Visibility.Collapsed;

    public Visibility BusyVisibility => IsBusy ? Visibility.Visible : Visibility.Collapsed;

    public Visibility AckButtonVisibility => RecoveryUnacked ? Visibility.Visible : Visibility.Collapsed;

    public Visibility RecoveryCodeInputVisibility => HasRecovery ? Visibility.Visible : Visibility.Collapsed;

    public Visibility RotateConfirmVisibility => ShowRotateConfirm ? Visibility.Visible : Visibility.Collapsed;

    public Visibility ExportConfirmVisibility => ShowExportConfirm ? Visibility.Visible : Visibility.Collapsed;

    public string ReloginWarning => "注意：" + ReloginConfirmLine;

    public string RecoveryStatusText
    {
        get
        {
            if (RecoveryUnacked)
            {
                return "你还没有确认已抄下恢复码。恢复码用于在主密码遗忘时找回数据；若未妥善保管，将无法恢复。确认后此提醒会消失。";
            }
            if (HasRecovery)
            {
                return "恢复码已确认妥善保管。";
            }
            return "本账号尚未设置恢复码。恢复码在网页端注册 / 初始化账号时生成；遗忘主密码时可用它找回数据（存量账号无法后补）。";
        }
    }

    // ---- R28 恢复码 ----

    public async Task InitializeAsync()
    {
        await RefreshRoleAsync();
    }

    public async Task RefreshRoleAsync()
    {
        if (_uid is null)
        {
            StatusMessage = "登录态缺失，请重新登录";
            StatusIsError = true;
            IsLoading = false;
            return;
        }
        IsLoading = true;
        StatusMessage = "";
        try
        {
            KbMyRole role = await _security.FetchMyRoleAsync();
            KdfSalt = role.KdfSalt;
            KdfVerifier = role.KdfVerifier;
            RoleKeyEpoch = role.KeyEpoch;
            RecoverySalt = role.RecoverySalt;
            RecoveryBlob = role.RecoveryBlob;
            RecoveryAckAt = role.RecoveryAckAt;
        }
        catch (Exception ex)
        {
            StatusMessage = "读取账号信息失败：" + ex.Message;
            StatusIsError = true;
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>R28：确认「我已抄下并自行保管」（kbAckRecovery）。</summary>
    public async Task AckRecoveryAsync()
    {
        if (IsBusy || _uid is null) return;
        IsBusy = true;
        StatusMessage = "";
        try
        {
            await _security.AckRecoveryAsync();
            await RefreshRoleAsync();
            StatusMessage = "已记录：你已抄写并妥善保管恢复码。";
            StatusIsError = false;
        }
        catch (Exception ex)
        {
            StatusMessage = ex.Message;
            StatusIsError = true;
        }
        finally
        {
            IsBusy = false;
        }
    }

    // ---- R21 改主密码 ----

    /// <summary>表单校验：通过返回空串，否则返回错误文案。</summary>
    public string ValidateRotateForm()
    {
        if (OldPwd.Length == 0 || NewPwd.Length == 0) return "请填写原主密码与新主密码。";
        if (NewPwd.Length < 8) return "新主密码至少 8 位。";
        if (NewPwd != ConfirmPwd) return "两次输入的新主密码不一致。";
        if (HasRecovery && KbRecovery.NormalizeRecoveryCode(RecoveryCode).Length != 32)
        {
            return "本账号已设恢复码：请再次输入恢复码，以便用新主密钥重包裹（否则恢复码将失效）。";
        }
        return "";
    }

    /// <summary>点击「修改主密码」：校验通过后进入确认区（内联，避免 WinUI 嵌套 ContentDialog）。</summary>
    public void RequestRotate()
    {
        string error = ValidateRotateForm();
        if (error.Length > 0)
        {
            StatusMessage = error;
            StatusIsError = true;
            return;
        }
        ShowRotateConfirm = true;
        StatusMessage = "";
    }

    public void DismissRotateConfirm()
    {
        ShowRotateConfirm = false;
    }

    /// <summary>确认修改：事务性在 Core；成功后删 Windows Hello 包裹物（包裹的是旧密钥）、清空表单、通知刷新。</summary>
    public async Task<bool> DoRotateAsync()
    {
        if (IsBusy || _uid is null) return false;
        ShowRotateConfirm = false;
        IsBusy = true;
        StatusMessage = "";
        try
        {
            var role = new KbMyRole("", "", KdfSalt, KdfVerifier, RoleKeyEpoch, RecoverySalt, RecoveryBlob, RecoveryAckAt);
            RotateResult result = await _security.RotateMasterAsync(_uid, OldPwd, NewPwd, RecoveryCode, role);

            // 会话保持（MasterKeySession 已更新）；删除旧密钥的 Hello 包裹物
            AppServices.HelloStore.Delete();

            OldPwd = "";
            NewPwd = "";
            ConfirmPwd = "";
            RecoveryCode = "";
            StatusMessage = $"主密码已更新（密钥代数 → {result.NewKeyEpoch}）。请用新主密码解锁。其他设备下次打开需要重新登录。";
            StatusIsError = false;
            await RefreshRoleAsync();
            DataChanged?.Invoke();
            return true;
        }
        catch (Exception ex)
        {
            StatusMessage = ex.Message;
            StatusIsError = true;
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }

    // ---- R29 导出 ----

    /// <summary>点击「导出备份」：进入明文警告确认区。</summary>
    public void RequestExport()
    {
        ShowExportConfirm = true;
        StatusMessage = "";
    }

    public void DismissExportConfirm()
    {
        ShowExportConfirm = false;
    }

    /// <summary>确认导出：全量解密并暂存 JSON；无内容返回 false（UI 不弹保存框）。</summary>
    public async Task<bool> PrepareExportAsync()
    {
        if (IsBusy || _uid is null) return false;
        ShowExportConfirm = false;
        IsBusy = true;
        StatusMessage = "";
        try
        {
            ExportResult result = await _security.PrepareExportAsync(_uid);
            if (result.Count == 0)
            {
                StatusMessage = "没有可导出的密钥。";
                StatusIsError = true;
                return false;
            }
            PendingExportJson = result.Json;
            PendingExportCount = result.Count;
            PendingExportSkipped = result.Skipped;
            return true;
        }
        catch (Exception ex)
        {
            StatusMessage = "导出失败：" + ex.Message;
            StatusIsError = true;
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>FileSavePicker 写盘成功后调用：生成提示并清空暂存。</summary>
    public void NotifyExportWritten()
    {
        string msg = $"已导出 {PendingExportCount} 条到 JSON 文件"
            + (PendingExportSkipped > 0 ? $"（{PendingExportSkipped} 条解密失败已跳过）" : "")
            + "。明文文件，请妥善保管，建议用后尽快删除。";
        StatusMessage = msg;
        StatusIsError = false;
        PendingExportJson = "";
        PendingExportCount = 0;
        PendingExportSkipped = 0;
    }

    /// <summary>用户取消保存：清空暂存。</summary>
    public void CancelExport()
    {
        StatusMessage = "已取消导出。";
        StatusIsError = false;
        PendingExportJson = "";
        PendingExportCount = 0;
        PendingExportSkipped = 0;
    }

    // ---- R29 导入 ----

    /// <summary>解析 + 逐条加密上传；返回是否成功（成功时宿主刷新列表）。</summary>
    public async Task<bool> ImportAsync(string jsonText)
    {
        if (IsBusy || _uid is null) return false;
        IsBusy = true;
        StatusMessage = "";
        try
        {
            ImportResult result = await _security.ImportAsync(_uid, jsonText);
            StatusMessage = $"已导入 {result.Imported} 条（{result.Skipped} 条格式非法已跳过）。";
            StatusIsError = false;
            DataChanged?.Invoke();
            return true;
        }
        catch (Exception ex)
        {
            StatusMessage = "导入失败：" + ex.Message;
            StatusIsError = true;
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }
}
