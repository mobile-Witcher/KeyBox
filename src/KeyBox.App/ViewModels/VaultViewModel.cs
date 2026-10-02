using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KeyBox.Core.Data;
using KeyBox.Core.Vault;
using Microsoft.UI.Xaml;
using Windows.ApplicationModel.DataTransfer;

namespace KeyBox.App.ViewModels;

/// <summary>分类下拉选项：Tag=null 表示「全部密钥」。</summary>
public sealed record TagOption(string? Tag, string Display, int Count)
{
    public override string ToString() => Display;
}

/// <summary>
/// 密钥库 ViewModel（W3 扩展）：
///   - 只读解密渲染 + 复制护栏（W2）
///   - 新增/编辑/删除（CRUD，ContentDialog 承载表单，网络失败保留输入）
///   - 本机搜索 + 分类收集/过滤/重命名/删除（纯内存，关键词不出设备）
///   - 双向同步 + 冲突裁决（照安卓 A4 语义）
/// </summary>
public partial class VaultViewModel : ObservableObject
{
    private const int CopyGuardSeconds = 30;
    private static readonly StringComparer ZhComparer =
        StringComparer.Create(CultureInfo.GetCultureInfo("zh-Hans-CN"), ignoreCase: false);

    private readonly VaultService _vault;
    private readonly string? _uid;
    private List<VaultItem> _allItems = new();
    private CancellationTokenSource? _copyCts;

    /// <summary>退出登录请求（页面据此走 SignOutAndGoLogin）。</summary>
    public event Action? LogoutRequested;

    // ---- 列表 / 状态 ----
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(EmptyListVisibility))]
    [NotifyPropertyChangedFor(nameof(NoMatchVisibility))]
    [NotifyPropertyChangedFor(nameof(LoadingVisibility))]
    private bool _isLoading = true;

    [ObservableProperty]
    private bool _isRefreshing;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SyncButtonEnabled))]
    private bool _isSyncing;

    [ObservableProperty]
    private string _statusMessage = "";

    [ObservableProperty]
    private int _copyCountdown;

    [ObservableProperty]
    private string _uidText = "";

    [ObservableProperty]
    private string _countText = "我的密钥";

    [ObservableProperty]
    private ObservableCollection<VaultItemViewModel> _visibleItems = new();

    // ---- 搜索 / 分类 ----
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(NoMatchText))]
    private string _searchKw = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(TagManageEnabled))]
    private string? _activeTag;

    [ObservableProperty]
    private ObservableCollection<TagOption> _tagOptions = new();

    [ObservableProperty]
    private TagOption? _selectedTagOption;

    // ---- 编辑表单（ContentDialog 承载） ----
    [ObservableProperty]
    private string _editorTitle = "新增密钥";

    [ObservableProperty]
    private long? _editingItemId;

    [ObservableProperty]
    private string _formSite = "";

    [ObservableProperty]
    private string _formUrl = "";

    [ObservableProperty]
    private string _formWebsite = "";

    [ObservableProperty]
    private string _formModel = "";

    [ObservableProperty]
    private string _formKey = "";

    [ObservableProperty]
    private string _formNote = "";

    [ObservableProperty]
    private string _formTagsText = "";

    [ObservableProperty]
    private string _formError = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(EditorSaveEnabled))]
    private bool _isSubmitting;

    // ---- 删除 ----
    [ObservableProperty]
    private VaultItemViewModel? _deleteTarget;

    [ObservableProperty]
    private bool _isDeleting;

    // ---- 分类管理 ----
    [ObservableProperty]
    private bool _showTagRename;

    [ObservableProperty]
    private string _tagRenameText = "";

    [ObservableProperty]
    private string? _tagDeleteName;

    [ObservableProperty]
    private int _tagDeleteCount;

    [ObservableProperty]
    private bool _isTagBusy;

    // ---- 冲突 ----
    [ObservableProperty]
    private List<SyncConflict> _pendingConflicts = new();

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ConflictBannerVisibility))]
    private string _conflictBannerText = "";

    [ObservableProperty]
    private bool _showConflictDialog;

    public VaultViewModel(VaultService vault, string? uid)
    {
        _vault = vault;
        _uid = uid;
        UidText = string.IsNullOrEmpty(uid) ? "" : uid;
    }

    // ---- 展示辅助 ----
    public Visibility LoadingVisibility => IsLoading ? Visibility.Visible : Visibility.Collapsed;

    public Visibility EmptyListVisibility =>
        !IsLoading && _allItems.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

    public Visibility NoMatchVisibility =>
        !IsLoading && _allItems.Count > 0 && VisibleItems.Count == 0 && SearchKw.Trim().Length > 0
            ? Visibility.Visible
            : Visibility.Collapsed;

    public Visibility ConflictBannerVisibility =>
        PendingConflicts.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

    public bool SyncButtonEnabled => !IsSyncing && !IsLoading;

    public bool EditorSaveEnabled => !IsSubmitting;

    /// <summary>选中了某个分类时，才允许重命名/删除分类。</summary>
    public bool TagManageEnabled => ActiveTag is not null;

    /// <summary>搜索无匹配空态文案。</summary>
    public string NoMatchText =>
        string.IsNullOrWhiteSpace(SearchKw) ? "" : $"没有找到匹配「{SearchKw.Trim()}」的密钥";

    // ---- 加载 / 刷新 / 同步 ----

    public async Task LoadAsync()
    {
        await FetchAsync(refreshing: false);
    }

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
            _allItems = await _vault.FetchAndDecryptAsync(_uid);
            RecomputeVisible();
            StatusMessage = _allItems.Count == 0 ? "暂无密钥" : "";
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

    /// <summary>双向同步：拉取 → 比对（拉取/上传/冲突）→ 完成后重载。</summary>
    [RelayCommand]
    private async Task RunSyncAsync()
    {
        if (IsSyncing || string.IsNullOrEmpty(_uid)) return;
        IsSyncing = true;
        StatusMessage = "正在同步…";
        try
        {
            SyncResult result = await _vault.RunSyncAsync(_uid, _allItems);
            _allItems = result.Items;
            PendingConflicts = result.Conflicts;
            ConflictBannerText = result.Conflicts.Count > 0 ? $"{result.Conflicts.Count} 处冲突待处理，点击处理" : "";
            RecomputeVisible();

            string msg = "已同步";
            if (result.Pulled + result.Pushed > 0) msg += $" · {result.Pulled + result.Pushed} 条更新";
            if (result.Conflicts.Count > 0) msg += $" · {result.Conflicts.Count} 处冲突待处理";
            StatusMessage = msg;

            await FetchAsync(refreshing: true); // 重载以服务端为准（幂等）
        }
        catch (Exception ex)
        {
            StatusMessage = "同步失败：" + ex.Message;
        }
        finally
        {
            IsSyncing = false;
        }
    }

    /// <summary>冲突裁决：整体二选一（保留本机=重加密上传 / 用服务端=解密覆盖）。</summary>
    public async Task<bool> ResolveConflictsAsync(bool useRemote)
    {
        if (string.IsNullOrEmpty(_uid) || PendingConflicts.Count == 0 || IsSyncing) return false;
        IsSyncing = true;
        StatusMessage = useRemote ? "正在采用服务端版本…" : "正在保留本机版本…";
        try
        {
            ResolveResult result = await _vault.ResolveConflictsAsync(_uid, useRemote, PendingConflicts, _allItems);
            _allItems = result.Items;
            PendingConflicts = new List<SyncConflict>();
            ConflictBannerText = "";
            ShowConflictDialog = false;
            StatusMessage = "冲突已处理：" + (useRemote ? "已采用服务端版本" : "已保留本机版本")
                + (result.FailCount > 0 ? $"（{result.FailCount} 条上传失败）" : "");
            RecomputeVisible();
            await FetchAsync(refreshing: true);
            return true;
        }
        catch (Exception ex)
        {
            StatusMessage = "冲突处理失败：" + ex.Message;
            return false;
        }
        finally
        {
            IsSyncing = false;
        }
    }

    // ---- 搜索 / 分类过滤 ----

    partial void OnSearchKwChanged(string value)
    {
        RecomputeVisible();
    }

    partial void OnActiveTagChanged(string? value)
    {
        RecomputeVisible();
    }

    /// <summary>分类下拉选择（TagOption.Tag 为 null 表示全部）。</summary>
    public void SelectTag(string? tag)
    {
        if (ActiveTag == tag) return;
        ActiveTag = tag;
    }

    /// <summary>重算分类统计 / 可见列表 / 计数（纯内存，关键词不出设备）。</summary>
    private void RecomputeVisible()
    {
        // 分类统计（只统计可解密条目，照 collectTags；中文排序）
        var counter = new Dictionary<string, int>();
        foreach (VaultItem item in _allItems)
        {
            if (item.DecryptError) continue;
            foreach (string tag in item.Tags)
            {
                counter[tag] = counter.GetValueOrDefault(tag) + 1;
            }
        }

        var options = new List<TagOption> { new(null, $"全部密钥（{_allItems.Count}）", _allItems.Count) };
        options.AddRange(counter
            .OrderBy(kv => kv.Key, ZhComparer)
            .Select(kv => new TagOption(kv.Key, $"{kv.Key}（{kv.Value}）", kv.Value)));
        TagOptions = new ObservableCollection<TagOption>(options);

        // 选中分类若已不存在则回退全部
        if (ActiveTag is not null && !counter.ContainsKey(ActiveTag))
        {
            ActiveTag = null;
        }
        SelectedTagOption = TagOptions.FirstOrDefault(o => o.Tag == ActiveTag) ?? TagOptions.FirstOrDefault();

        // 过滤（照 filterItems：解密失败条目仅在无标签筛选且无关键词时保留）
        string kw = SearchKw.Trim().ToLowerInvariant();
        List<VaultItem> visible = _allItems.Where(item =>
        {
            if (item.DecryptError)
            {
                return ActiveTag is null && kw.Length == 0;
            }
            if (ActiveTag is not null && !item.Tags.Contains(ActiveTag)) return false;
            if (kw.Length == 0) return true;
            var haystack = string.Join(" ",
                    new[] { item.Site, item.Url, item.Website, item.Model, item.Note, string.Join(" ", item.Tags) })
                .ToLowerInvariant();
            return haystack.Contains(kw, StringComparison.Ordinal);
        }).ToList();

        VisibleItems = new ObservableCollection<VaultItemViewModel>(
            visible.Select(i => new VaultItemViewModel(i)));
        CountText = $"我的密钥（{visible.Count}/{_allItems.Count}）";

        OnPropertyChanged(nameof(EmptyListVisibility));
        OnPropertyChanged(nameof(NoMatchVisibility));
    }

    /// <summary>清空搜索关键词。</summary>
    [RelayCommand]
    private void ClearSearch()
    {
        SearchKw = "";
    }

    // ---- CRUD：编辑对话框 ----

    public void OpenNewEditor()
    {
        EditingItemId = null;
        EditorTitle = "新增密钥";
        FormSite = "";
        FormUrl = "";
        FormWebsite = "";
        FormModel = "";
        FormKey = "";
        FormNote = "";
        FormTagsText = "";
        FormError = "";
    }

    public void OpenEditor(VaultItemViewModel vm)
    {
        if (vm.IsDecryptError)
        {
            StatusMessage = "该条解密失败，无法编辑";
            return;
        }
        var it = vm.Item;
        EditingItemId = it.Id;
        EditorTitle = "编辑密钥";
        FormSite = it.Site;
        FormUrl = it.Url;
        FormWebsite = it.Website;
        FormModel = it.Model;
        FormKey = it.Key;
        FormNote = it.Note;
        FormTagsText = string.Join(",", it.Tags);
        FormError = "";
    }

    /// <summary>提交新增/编辑；成功返回 true（页面关闭对话框），失败保留表单输入。</summary>
    public async Task<bool> SubmitEditorAsync()
    {
        if (IsSubmitting) return false;

        string site = FormSite.Trim();
        string key = FormKey.Trim();
        if (site.Length == 0 || key.Length == 0)
        {
            FormError = "站点名称与密钥为必填项";
            return false;
        }
        if (string.IsNullOrEmpty(_uid))
        {
            FormError = "登录态缺失，请重新登录";
            return false;
        }
        if (MasterKeySession.MasterKeyRaw() is null)
        {
            FormError = "主密钥未解锁，请重新解锁";
            return false;
        }

        IsSubmitting = true;
        FormError = "";
        try
        {
            var plain = new SecretItem(
                site,
                FormUrl.Trim(),
                FormWebsite.Trim(),
                FormModel.Trim(),
                key,
                FormNote.Trim(),
                SecretCodec.ParseTags(FormTagsText));

            if (EditingItemId is long id)
            {
                await _vault.UpdateAsync(id, plain);
            }
            else
            {
                await _vault.CreateAsync(plain);
            }

            IsSubmitting = false;
            StatusMessage = "已保存";
            await FetchAsync(refreshing: true);
            return true;
        }
        catch (KeyBox.Core.Auth.AuthApiException ex) when (ex.Message.Contains("密钥代数"))
        {
            IsSubmitting = false;
            FormError = "密钥代数已变化，请先同步";
            return false;
        }
        catch (Exception ex)
        {
            IsSubmitting = false;
            FormError = "保存失败：" + ex.Message; // 保留表单输入
            return false;
        }
    }

    // ---- CRUD：删除 ----

    public void RequestDelete(VaultItemViewModel vm)
    {
        DeleteTarget = vm;
    }

    public void DismissDelete()
    {
        if (!IsDeleting) DeleteTarget = null;
    }

    public async Task<bool> ConfirmDeleteAsync()
    {
        VaultItemViewModel? target = DeleteTarget;
        if (target is null) return false;
        if (string.IsNullOrEmpty(_uid))
        {
            DeleteTarget = null;
            StatusMessage = "登录态缺失，请重新登录";
            return false;
        }

        IsDeleting = true;
        try
        {
            await _vault.DeleteAsync(target.Item.Id);
            DeleteTarget = null;
            StatusMessage = "已删除";
            await FetchAsync(refreshing: true);
            return true;
        }
        catch (KeyBox.Core.Auth.AuthApiException ex) when (ex.Message.Contains("密钥代数"))
        {
            DeleteTarget = null;
            StatusMessage = "密钥代数已变化，请先同步";
            return false;
        }
        catch (Exception ex)
        {
            DeleteTarget = null;
            StatusMessage = "删除失败：" + ex.Message;
            return false;
        }
        finally
        {
            IsDeleting = false;
        }
    }

    // ---- 分类管理（R18：重命名 / 删除） ----

    public void OpenTagRename()
    {
        if (ActiveTag is null) return;
        TagRenameText = ActiveTag;
        ShowTagRename = true;
    }

    public void CloseTagRename()
    {
        if (!IsTagBusy) ShowTagRename = false;
    }

    public void OpenTagDelete()
    {
        if (ActiveTag is null) return;
        TagDeleteName = ActiveTag;
        TagDeleteCount = _allItems.Count(i => !i.DecryptError && i.Tags.Contains(ActiveTag));
    }

    /// <summary>确认重命名：新名为空视为取消。</summary>
    public async Task<bool> ConfirmTagRenameAsync()
    {
        string oldName = ActiveTag ?? "";
        if (oldName.Length == 0) return true;
        string next = TagRenameText.Trim();
        if (next.Length == 0)
        {
            ShowTagRename = false;
            return true;
        }
        return await ApplyTagChangeAsync(oldName, next);
    }

    /// <summary>确认删除分类（影响条数已在 OpenTagDelete 记录）。</summary>
    public async Task<bool> ConfirmTagDeleteAsync()
    {
        string oldName = TagDeleteName ?? "";
        if (oldName.Length == 0) return true;
        return await ApplyTagChangeAsync(oldName, null);
    }

    /// <summary>批量重加密上传（逐条 PATCH，失败收集后继续处理其余）。</summary>
    private async Task<bool> ApplyTagChangeAsync(string oldName, string? next)
    {
        if (string.IsNullOrEmpty(_uid) || IsTagBusy) return false;
        IsTagBusy = true;
        try
        {
            TagChangeResult result = await _vault.ApplyTagChangeAsync(_uid, oldName, next, _allItems);
            string action = next is null ? "删除" : "重命名";
            string suffix = next is null ? "" : $"→「{next}」";
            string baseMsg = $"已{action}分类「{oldName}」{suffix}，共更新 {result.OkCount} 条密钥";
            StatusMessage = result.Failures.Count == 0
                ? baseMsg
                : baseMsg + $"；{result.Failures.Count} 条失败（{string.Join("；", result.Failures.Take(3))}…）";

            ShowTagRename = false;
            ActiveTag = next; // 重命名 → 新名；删除 → 全部
            await FetchAsync(refreshing: true);
            return true;
        }
        catch (Exception ex)
        {
            StatusMessage = "分类处理失败：" + ex.Message;
            return false;
        }
        finally
        {
            IsTagBusy = false;
        }
    }

    // ---- 复制护栏（R25，W2 保持） ----

    [RelayCommand]
    private void CopyKey(VaultItemViewModel vm)
    {
        if (vm is null || !vm.CanCopy) return;
        CopyProtected(vm.Item.Key, "密钥");
    }

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

    [RelayCommand]
    private void Logout()
    {
        _copyCts?.Cancel();
        LogoutRequested?.Invoke();
    }
}
