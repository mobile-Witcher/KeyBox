using KeyBox.Core.Data;
using KeyBox.Core.Vault;
using Microsoft.UI.Xaml;

namespace KeyBox.App.ViewModels;

/// <summary>密钥列表渲染项（包一层 VaultItem，暴露卡片所需展示属性；照安卓 VaultItem 语义）。</summary>
public sealed class VaultItemViewModel
{
    public VaultItem Item { get; }

    public VaultItemViewModel(VaultItem item)
    {
        Item = item;
    }

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

    /// <summary>脱敏密钥：sk-c8ab…9f2e 形态（照安卓 maskKey）。</summary>
    public string KeyDisplay => Item.DecryptError ? "" : SecretCodec.MaskKey(Item.Key);

    public string ErrorText => Item.DecryptErrMsg;

    public bool IsDecryptError => Item.DecryptError;

    public bool CanCopy => !Item.DecryptError && !string.IsNullOrEmpty(Item.Key);

    public Visibility ErrorVisibility => Item.DecryptError ? Visibility.Visible : Visibility.Collapsed;

    public Visibility KeyVisibility => CanCopy ? Visibility.Visible : Visibility.Collapsed;

    public Visibility CopyButtonVisibility => CanCopy ? Visibility.Visible : Visibility.Collapsed;

    /// <summary>编辑：解密失败条目不可编辑（照安卓 openEditor）。</summary>
    public Visibility EditButtonVisibility => Item.DecryptError ? Visibility.Collapsed : Visibility.Visible;

    /// <summary>删除：任何条目（含解密失败）都可删除（照安卓 confirmDelete）。</summary>
    public Visibility DeleteButtonVisibility => Visibility.Visible;
}
