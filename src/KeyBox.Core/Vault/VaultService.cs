using System.Text.Json;
using KeyBox.Core.Crypto;
using KeyBox.Core.Data;

namespace KeyBox.Core.Vault;

/// <summary>列表渲染项（照安卓 VaultItem：单条解密失败不阻断整表）。</summary>
public sealed record VaultItem(
    long Id,
    string Site,
    string Url,
    string Website,
    string Model,
    string Key,
    string Note,
    List<string> Tags,
    string UpdatedAt,
    bool DecryptError = false,
    string DecryptErrMsg = "");

/// <summary>
/// 密钥列表只读服务：拉取 kb_secrets → 逐条解密 → 渲染项。
/// 单条失败（解密异常 / 代数不符）标记 DecryptError，不阻断整表（照安卓 decryptRow / 鸿蒙 decryptRow）。
/// </summary>
public sealed class VaultService
{
    private readonly KbApi _api;

    public VaultService(KbApi api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
    }

    /// <summary>拉取 + 逐条解密（主密钥未解锁抛 InvalidOperationException；网络错误原样上抛）。</summary>
    public async Task<List<VaultItem>> FetchAndDecryptAsync(string uid, CancellationToken ct = default)
    {
        byte[]? raw = MasterKeySession.MasterKeyRaw()
            ?? throw new InvalidOperationException("主密钥未解锁");
        int keyEpoch = MasterKeySession.KeyEpoch;

        List<KbSecretRow> rows = await _api.FetchSecretRowsAsync(uid, ct).ConfigureAwait(false);
        var items = new List<VaultItem>(rows.Count);
        foreach (KbSecretRow row in rows)
        {
            items.Add(DecryptRow(row, raw, keyEpoch));
        }
        return items;
    }

    /// <summary>解密单行密文 → 渲染项（代数不符 / 解密失败单条标记，不阻断整表）。</summary>
    public static VaultItem DecryptRow(KbSecretRow row, byte[] raw, int keyEpoch)
    {
        var baseItem = new VaultItem(
            Id: row.Id,
            Site: "",
            Url: "",
            Website: "",
            Model: "",
            Key: "",
            Note: "",
            Tags: new List<string>(),
            UpdatedAt: row.UpdatedAt);

        if (row.KeyEpoch != keyEpoch)
        {
            return baseItem with
            {
                DecryptError = true,
                DecryptErrMsg = $"密文代数 {row.KeyEpoch} 与当前 {keyEpoch} 不一致",
            };
        }

        try
        {
            string plain = Kb1Crypto.DecryptFromKb1(raw, row.Payload);
            SecretItem item = SecretCodec.ParseSecretPayload(plain);
            return baseItem with
            {
                Site = item.Site,
                Url = item.Url,
                Website = item.Website,
                Model = item.Model,
                Key = item.Key,
                Note = item.Note,
                Tags = item.Tags,
            };
        }
        catch (Exception ex)
        {
            return baseItem with
            {
                DecryptError = true,
                DecryptErrMsg = ex.Message ?? "解密失败",
            };
        }
    }
}
