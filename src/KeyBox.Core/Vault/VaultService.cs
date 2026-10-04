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

/// <summary>一处同步冲突（两边都有且 updated_at 不同；照安卓 SyncConflictInfo）。</summary>
public sealed record SyncConflict(
    long Id,
    string Site,
    string LocalUpdatedAt,
    string RemoteUpdatedAt,
    string RemotePayload,
    int RemoteKeyEpoch);

/// <summary>一次同步的结果（照安卓 A4 语义）。</summary>
public sealed record SyncResult(
    List<VaultItem> Items,
    int Pulled,
    int Pushed,
    List<SyncConflict> Conflicts);

/// <summary>冲突裁决结果。</summary>
public sealed record ResolveResult(List<VaultItem> Items, int FailCount);

/// <summary>分类重命名/删除结果（逐条上传，失败收集继续处理其余）。</summary>
public sealed record TagChangeResult(int OkCount, List<string> Failures);

/// <summary>
/// 密钥库服务：只读解密（W2）+ 新增/编辑/删除 + 双向同步/冲突 + 分类批量重加密上传。
/// 全程使用内存单例 MasterKeySession，主密钥绝不落盘；错误走 AuthException / InvalidOperationException。
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

    /// <summary>
    /// 读取本人账号状态（kb_users.status）。§6.4 R13：数据层在停用后会立刻拒绝密钥读写，
    /// 客户端据此给出「账号已停用」的明确提示，而不是显示成「暂无密钥」。
    /// </summary>
    public Task<string> FetchMyStatusAsync(string uid, CancellationToken ct = default)
        => _api.FetchMyStatusAsync(uid, ct);

    // -------------------------------------------------------------------------
    // CRUD（W3）：serialize → EncryptToKb1 → RDB 写
    // -------------------------------------------------------------------------

    /// <summary>新增：POST insertSecretRow（key_epoch 当前；owner_id 由服务端 auth.uid() 写入）。</summary>
    public async Task CreateAsync(SecretItem item, CancellationToken ct = default)
    {
        byte[] raw = RequireMasterKey();
        int keyEpoch = MasterKeySession.KeyEpoch;
        string payload = Kb1Crypto.EncryptToKb1(raw, SecretCodec.SerializeSecretPayload(item));
        await _api.InsertSecretRowAsync(payload, keyEpoch, ct).ConfigureAwait(false);
    }

    /// <summary>编辑：重加密 → PATCH updateSecretRow（key_epoch 当前 + updated_at 本机当前）。</summary>
    public async Task UpdateAsync(long id, SecretItem item, CancellationToken ct = default)
    {
        byte[] raw = RequireMasterKey();
        int keyEpoch = MasterKeySession.KeyEpoch;
        string payload = Kb1Crypto.EncryptToKb1(raw, SecretCodec.SerializeSecretPayload(item));
        await _api.UpdateSecretRowAsync(id, payload, keyEpoch, ct).ConfigureAwait(false);
    }

    /// <summary>删除：DELETE deleteSecretRow（RLS 保证只能删自己的）。</summary>
    public async Task DeleteAsync(long id, CancellationToken ct = default)
    {
        await _api.DeleteSecretRowAsync(id, ct).ConfigureAwait(false);
    }

    // -------------------------------------------------------------------------
    // 双向同步（W3，照安卓 A4）：拉取 → 逐条比对（拉取/上传/冲突）
    // -------------------------------------------------------------------------

    /// <summary>
    /// 双向同步：服务端有本机无 → 解密入库（pulled）；本机有服务端无 → 加密上传（pushed）；
    /// 两边都有且 updated_at 不同 → 冲突（未决前保留本机版本）。
    /// </summary>
    public async Task<SyncResult> RunSyncAsync(string uid, List<VaultItem> currentItems, CancellationToken ct = default)
    {
        byte[] raw = RequireMasterKey();
        int keyEpoch = MasterKeySession.KeyEpoch;

        List<KbSecretRow> rows = await _api.FetchSecretRowsAsync(uid, ct).ConfigureAwait(false);
        HashSet<long> remoteIds = rows.Select(r => r.Id).ToHashSet();
        Dictionary<long, VaultItem> localMap = currentItems.ToDictionary(i => i.Id);

        var newItems = new List<VaultItem>();
        var conflicts = new List<SyncConflict>();
        int pulled = 0;

        foreach (KbSecretRow row in rows)
        {
            if (!localMap.TryGetValue(row.Id, out VaultItem? local))
            {
                newItems.Add(DecryptRow(row, raw, keyEpoch));
                pulled++;
            }
            else if (!SameTimestamp(row.UpdatedAt, local.UpdatedAt))
            {
                conflicts.Add(new SyncConflict(
                    row.Id,
                    local.Site,
                    local.UpdatedAt,
                    row.UpdatedAt,
                    row.Payload,
                    row.KeyEpoch));
                newItems.Add(local); // 冲突未决前保留本机版本
            }
            else
            {
                newItems.Add(local);
            }
        }

        int pushed = 0;
        foreach (VaultItem item in currentItems)
        {
            if (!remoteIds.Contains(item.Id) && !item.DecryptError)
            {
                string enc = Kb1Crypto.EncryptToKb1(raw, SecretCodec.SerializeSecretPayload(ToPlain(item)));
                await _api.InsertSecretRowAsync(enc, keyEpoch, ct).ConfigureAwait(false);
                pushed++;
                newItems.Add(item); // 本机版本先保留，重载后以服务端新 id 为准
            }
        }

        return new SyncResult(newItems, pulled, pushed, conflicts);
    }

    /// <summary>
    /// 冲突裁决：useRemote=true 用服务端覆盖本机（解密替换）；false 保留本机并重加密上传。
    /// 上传失败逐条计数，不中断其余。
    /// </summary>
    public async Task<ResolveResult> ResolveConflictsAsync(
        string uid,
        bool useRemote,
        List<SyncConflict> conflicts,
        List<VaultItem> currentItems,
        CancellationToken ct = default)
    {
        byte[] raw = RequireMasterKey();
        int keyEpoch = MasterKeySession.KeyEpoch;

        var items = currentItems.ToList();
        int fail = 0;

        foreach (SyncConflict cf in conflicts)
        {
            int idx = items.FindIndex(i => i.Id == cf.Id);
            if (useRemote)
            {
                var row = new KbSecretRow(cf.Id, cf.RemotePayload, cf.RemoteKeyEpoch, cf.RemoteUpdatedAt);
                VaultItem decrypted = DecryptRow(row, raw, keyEpoch);
                if (idx >= 0) items[idx] = decrypted;
                else items.Add(decrypted);
            }
            else if (idx >= 0)
            {
                try
                {
                    string enc = Kb1Crypto.EncryptToKb1(raw, SecretCodec.SerializeSecretPayload(ToPlain(items[idx])));
                    await _api.UpdateSecretRowAsync(cf.Id, enc, keyEpoch, ct).ConfigureAwait(false);
                }
                catch (Exception)
                {
                    fail++;
                }
            }
        }

        return new ResolveResult(items, fail);
    }

    // -------------------------------------------------------------------------
    // 分类管理（R18，照 Web mapTagChange / 安卓 applyTagChange）
    // -------------------------------------------------------------------------

    /// <summary>
    /// 分类重命名（next=新名）或删除（next=null）：逐条重加密上传，失败收集后继续处理其余。
    /// </summary>
    public async Task<TagChangeResult> ApplyTagChangeAsync(
        string uid,
        string oldName,
        string? next,
        List<VaultItem> currentItems,
        CancellationToken ct = default)
    {
        byte[] raw = RequireMasterKey();
        int keyEpoch = MasterKeySession.KeyEpoch;

        List<VaultItem> changed = currentItems
            .Where(i => !i.DecryptError && i.Tags.Contains(oldName))
            .ToList();
        if (changed.Count == 0)
        {
            return new TagChangeResult(0, new List<string>());
        }

        int ok = 0;
        var failures = new List<string>();
        foreach (VaultItem item in changed)
        {
            try
            {
                var newTags = MapTags(item.Tags, oldName, next);
                var plain = ToPlain(item) with { Tags = newTags };
                string enc = Kb1Crypto.EncryptToKb1(raw, SecretCodec.SerializeSecretPayload(plain));
                await _api.UpdateSecretRowAsync(item.Id, enc, keyEpoch, ct).ConfigureAwait(false);
                ok++;
            }
            catch (Exception ex)
            {
                failures.Add($"#{item.Id}: {ex.Message}");
            }
        }

        return new TagChangeResult(ok, failures);
    }

    // -------------------------------------------------------------------------
    // 解密渲染 / 工具
    // -------------------------------------------------------------------------

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

    /// <summary>列表项 → 明文结构（重加密用）。</summary>
    public static SecretItem ToPlain(VaultItem item)
        => new(item.Site, item.Url, item.Website, item.Model, item.Key, item.Note, item.Tags);

    /// <summary>重命名去重 / 删除移除；保持原顺序（照 Web mapTagChange / 安卓 mapTags）。</summary>
    public static List<string> MapTags(List<string> tags, string oldName, string? next)
    {
        var outTags = new List<string>();
        foreach (string t in tags)
        {
            if (t == oldName)
            {
                if (next is { Length: > 0 } && !outTags.Contains(next))
                {
                    outTags.Add(next);
                }
            }
            else if (!outTags.Contains(t))
            {
                outTags.Add(t);
            }
        }
        return outTags;
    }

    /// <summary>updated_at 是否视作相同（先比原文，再比 ISO 时间戳，容格式差异；照 sameTimestamp）。</summary>
    public static bool SameTimestamp(string a, string b)
    {
        if (a == b) return true;
        return DateTimeOffset.TryParse(a, out DateTimeOffset ta)
            && DateTimeOffset.TryParse(b, out DateTimeOffset tb)
            && ta == tb;
    }

    private static byte[] RequireMasterKey()
        => MasterKeySession.MasterKeyRaw() ?? throw new InvalidOperationException("主密钥未解锁");
}
