using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KeyBox.Core.Vault;
using Microsoft.UI.Xaml;
using Windows.ApplicationModel.DataTransfer;

namespace KeyBox.App.ViewModels;

/// <summary>
/// 密钥库（只读）ViewModel：拉取 kb_secrets → 逐条解密 → 卡片渲染；
/// 复制护栏：复制密钥后 30 秒倒计时到点真正清空剪贴板（照安卓 R25 语义，重复复制重置倒计时）。
/// W2 只读：编辑/删除/新增留到 W3。
/// </summary>
public partial class VaultViewModel : ObservableObject
{
    private const int CopyGuardSeconds = 30;

    private readonly VaultService _vault;
    private readonly string? _uid;
    private CancellationTokenSource? _copyCts;

    /// <summary>退出登录请求（页面据此走 SignOutAndGoLogin）。</summary>
    public event Action? LogoutRequested;

    [ObservableProperty]
    private ObservableCollection<VaultItemViewModel> _items = new();

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(LoadingVisibility))]
    private bool _isLoading = true;

    [ObservableProperty]
    private bool _isRefreshing;

    [ObservableProperty]
    private string _statusMessage = "";

    [ObservableProperty]
    private int _copyCountdown;

    [ObservableProperty]
    private string _uidText = "";

    public Visibility LoadingVisibility => IsLoading ? Visibility.Visible : Visibility.Collapsed;

    public VaultViewModel(VaultService vault, string? uid)
    {
        _vault = vault;
        _uid = uid;
        UidText = string.IsNullOrEmpty(uid) ? "" : uid;
    }

    public async Task LoadAsync()
    {
        await FetchAsync(refreshing: false);
    }

    /// <summary>按钮刷新：重新拉取并解密（简单版，完整同步 W3 再做）。</summary>
    [RelayCommand]
    private async Task RefreshAsync()
    {
        await FetchAsync(refreshing: true);
    }

    private async Task FetchAsync(bool refreshing)
    {
        if (string.IsNullOrEmpty(_uid))
        {
            StatusMessage = "登录态缺失，请重新登录";
            IsLoading = false;
            IsRefreshing = false;
            return;
        }

        if (refreshing) IsRefreshing = true; else IsLoading = true;
        StatusMessage = "";
        try
        {
            List<VaultItem> list = await _vault.FetchAndDecryptAsync(_uid);
            Items = new ObservableCollection<VaultItemViewModel>(
                list.Select(item => new VaultItemViewModel(item)));
            StatusMessage = list.Count == 0 ? "暂无密钥" : $"共 {list.Count} 条密钥";
        }
        catch (Exception ex)
        {
            StatusMessage = "加载失败：" + ex.Message;
        }
        finally
        {
            IsLoading = false;
            IsRefreshing = false;
        }
    }

    /// <summary>复制密钥 + 30 秒自动清空剪贴板（R25 护栏）。</summary>
    [RelayCommand]
    private void CopyKey(VaultItemViewModel vm)
    {
        if (vm is null || !vm.CanCopy) return;
        CopyProtected(vm.Item.Key, "密钥");
    }

    /// <summary>复制任意字段到剪贴板 + 倒计时清空（统一护栏，不新造一套）。</summary>
    private void CopyProtected(string text, string label)
    {
        if (string.IsNullOrEmpty(text)) return;

        var package = new DataPackage();
        package.SetText(text);
        Clipboard.SetContent(package);
        Clipboard.Flush();

        _copyCts?.Cancel();
        _copyCts = new CancellationTokenSource();
        CancellationToken token = _copyCts.Token;
        _ = RunCopyCountdownAsync(label, token);
    }

    /// <summary>倒计时结束后真正清空剪贴板（照安卓：ClipData 空文本）。</summary>
    private async Task RunCopyCountdownAsync(string label, CancellationToken token)
    {
        for (int left = CopyGuardSeconds; left >= 1; left--)
        {
            CopyCountdown = left;
            StatusMessage = $"已复制{label}，{left} 秒后自动清空剪贴板";
            try
            {
                await Task.Delay(1000, token);
            }
            catch (TaskCanceledException)
            {
                return; // 新的复制已接管
            }
        }

        var clearPackage = new DataPackage();
        clearPackage.SetText("");
        Clipboard.SetContent(clearPackage);
        Clipboard.Flush();

        CopyCountdown = 0;
        StatusMessage = "剪贴板已自动清空";
    }

    /// <summary>退出登录（页面调用 AppServices.SignOutAndGoLogin）。</summary>
    [RelayCommand]
    private void Logout()
    {
        _copyCts?.Cancel();
        LogoutRequested?.Invoke();
    }
}
