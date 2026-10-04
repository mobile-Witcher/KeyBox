using KeyBox.Core.Data;
using KeyBox.Core.Vault;
using Microsoft.UI.Xaml;

namespace KeyBox.App.ViewModels;

/// <summary>
/// 密钥列表渲染项（包一层 VaultItem，暴露卡片所需展示属性；照安卓 VaultItem 与 Web SecretCardGrid 语义）。
///
/// W7-E 视觉打磨新增（照 Web SecretCardGrid.tsx / SecretTable.tsx 的视觉与护栏语义）：
///   - 徽章文字 <see cref="Initials"/>、域名 <see cref="HostLine"/>、分类胶囊 <see cref="TagChips"/>
///   - 逐字段复制（站点 / 接口地址 / 官网 / 模型名 / 备注），各自可点
///   - 密钥"先显示才能复制"：<see cref="IsRevealable"/> / <see cref="RevealActionText"/>（默认掩码）
///
/// ⚠️ 本类**刻意不实现 INotifyPropertyChanged**：字段全部派生自不可变记录 <see cref="VaultItem"/>，
///    列表刷新走 VaultViewModel 整体替换集合 + Mode=OneWay（见交接书 §6.2）。W7-E 若引入"逐条可变"状态
///    （如单条显示/隐藏、单条复制倒计时），必须继承 ObservableObject，否则绑上去也不会刷新。
/// </summary>
public sealed class VaultItemViewModel
{
    public VaultItem Item { get; }

    /// <summary>
    /// W7-E「先点显示才能复制密钥」的展开状态，由父 VM（<c>VaultViewModel._revealedIds</c>）在
    /// 重建集合时注入（照 AdminUserItem.IsSelfUser 的 init 注入写法）。
    /// </summary>
    public bool IsRevealed { get; init; }

    public VaultItemViewModel(VaultItem item)
    {
        Item = item;
    }

    // ---- 头部：徽章 / 标题 / 副标题 ----

    /// <summary>卡片标题：站点名（缺失给占位）。</summary>
    public string Site => string.IsNullOrWhiteSpace(Item.Site) ? "（未命名站点）" : Item.Site;

    /// <summary>副标题：域名 · 分类（照任务「站点名 + 域名·分类」）。</summary>
    public string Subtitle
    {
        get
        {
            var parts = new List<string>();
            if (!string.IsNullOrWhiteSpace(Item.Website)) parts.Add(Item.Website);
            if (Item.Tags.Count > 0) parts.Add(string.Join("、", Item.Tags));
            return string.Join(" · ", parts);
        }
    }

    /// <summary>
    /// 站点徽章文字（照 Web initialsOf）：中文取首字、西文取前两字符并大写。
    /// 解密失败显示「!」。
    /// </summary>
    public string Initials
    {
        get
        {
            if (Item.DecryptError) return "!";

            string raw = Item.Site.Trim();
            if (raw.Length == 0) return "?";

            char first = raw[0];
            bool ascii = (first >= 'A' && first <= 'Z') || (first >= 'a' && first <= 'z')
                         || (first >= '0' && first <= '9');
            return ascii
                ? raw[..Math.Min(2, raw.Length)].ToUpperInvariant()
                : first.ToString().ToUpperInvariant();
        }
    }

    /// <summary>接口地址行的域名（照 Web hostOf：解析失败原样返回）。</summary>
    public string HostLine
    {
        get
        {
            string url = Item.Url.Trim();
            if (url.Length == 0) return "未填接口地址";
            if (Uri.TryCreate(url, UriKind.Absolute, out Uri? uri) && !string.IsNullOrEmpty(uri.Host))
            {
                return uri.Host;
            }

            return url;
        }
    }

    // ---- 密钥：默认掩码，先「显示」才能复制 ----

    /// <summary>展示的密钥文本：已展开给明文，否则脱敏（sk-c8ab…9f2e）。解密失败为空。</summary>
    public string KeyDisplay => Item.DecryptError
        ? ""
        : IsRevealed ? Item.Key : SecretCodec.MaskKey(Item.Key);

    public string ErrorText => Item.DecryptErrMsg;

    public bool IsDecryptError => Item.DecryptError;

    /// <summary>能否展开显示（解密失败或空密钥不可）。</summary>
    public bool IsRevealable => !Item.DecryptError && !string.IsNullOrEmpty(Item.Key);

    /// <summary>「显示 / 隐藏」按钮文案（照 Web SecretTable: isRevealed ? "隐藏" : "显示"）。</summary>
    public string RevealActionText => IsRevealed ? "隐藏" : "显示";

    /// <summary>「先点显示才能复制」：未展开前复制被禁用（照 Web SecretTable: disabled={!isRevealed}）。</summary>
    public bool CanCopyKey => IsRevealable && IsRevealed;

    /// <summary>密钥行是否可见（可解密即有内容可展示）。</summary>
    public bool CanCopy => IsRevealable;

    // ---- 逐字段复制可用性（照 Web Cell 的 disabled 判据）----

    public bool CanCopySite => !Item.DecryptError && !string.IsNullOrWhiteSpace(Item.Site);

    public bool CanCopyUrl => !Item.DecryptError && !string.IsNullOrWhiteSpace(Item.Url);

    public bool CanCopyWebsite => !Item.DecryptError && !string.IsNullOrWhiteSpace(Item.Website);

    public bool CanCopyModel => !Item.DecryptError && !string.IsNullOrWhiteSpace(Item.Model);

    public bool CanCopyNote => !Item.DecryptError && !string.IsNullOrWhiteSpace(Item.Note);

    // ---- 可见性 ----

    public Visibility ErrorVisibility => Item.DecryptError ? Visibility.Visible : Visibility.Collapsed;

    public Visibility KeyVisibility => CanCopy ? Visibility.Visible : Visibility.Collapsed;

    /// <summary>编辑：解密失败条目不可编辑（照安卓 openEditor）。</summary>
    public Visibility EditButtonVisibility => Item.DecryptError ? Visibility.Collapsed : Visibility.Visible;

    /// <summary>删除：任何条目（含解密失败）都可删除（照安卓 confirmDelete）。</summary>
    public Visibility DeleteButtonVisibility => Visibility.Visible;

    // ---- 分类 / 徽章色调（照 Web SecretCardGrid 的 categoryOf + toneOf）----

    /// <summary>所属分类：取第一个非空标签；无标签则「未分类」。</summary>
    public string Category => Item.Tags.FirstOrDefault(t => !string.IsNullOrWhiteSpace(t)) ?? "未分类";

    /// <summary>分类标签胶囊（不含空白项）。</summary>
    public List<string> ChipTags => Item.Tags.Where(t => !string.IsNullOrWhiteSpace(t)).ToList();

    /// <summary>是否有模型名（决定 chip 文案）。</summary>
    public string ModelText => string.IsNullOrWhiteSpace(Item.Model) ? "未填模型名" : Item.Model;

    public bool HasTags => ChipTags.Count > 0;

    /// <summary>
    /// 由分类名稳定选出的色调下标 0..3（同名恒同色，重渲染不跳色）。
    /// ⚠️ 刻意不返回 Brush：给 DataTemplate 4 个叠加元素按 Visibility 选主题画刷，
    ///    这样换肤时 {ThemeResource Kb*} 自动重新求值，不会出现缓存画刷失效的问题。
    /// </summary>
    public int ToneIndex
    {
        get
        {
            int hash = 0;
            foreach (char ch in Category)
            {
                hash = (hash + ch) % 9973;
            }

            return hash % 4;
        }
    }

    public Visibility TonePrimaryVisibility => ToneIndex == 0 ? Visibility.Visible : Visibility.Collapsed;

    public Visibility ToneSuccessVisibility => ToneIndex == 1 ? Visibility.Visible : Visibility.Collapsed;

    public Visibility ToneWarningVisibility => ToneIndex == 2 ? Visibility.Visible : Visibility.Collapsed;

    public Visibility ToneDangerVisibility => ToneIndex == 3 ? Visibility.Visible : Visibility.Collapsed;
}
