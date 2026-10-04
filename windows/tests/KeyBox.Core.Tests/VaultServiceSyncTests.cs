using System.Net;
using System.Text.Json;
using KeyBox.Core.Crypto;
using KeyBox.Core.Data;
using KeyBox.Core.Vault;
using Xunit;

namespace KeyBox.Core.Tests;

/// <summary>双向同步 / 冲突裁决 / 分类批量重加密上传测试（照安卓 A4 + Web mapTagChange 语义）。</summary>
public class VaultServiceSyncTests : IDisposable
{
    private const string ApiBase = "https://env-test-000000.api.tcloudbasegateway.com";
    private readonly byte[] _key;
    private readonly int _epoch = 5;

    public VaultServiceSyncTests()
    {
        string salt = Kb1Crypto.GenerateSaltB64();
        _key = Kb1Crypto.DeriveKey("sync-password", salt);
        MasterKeySession.Set(_key, _epoch);
    }

    public void Dispose()
    {
        MasterKeySession.Clear();
    }

    private static string SecretJson(SecretItem item) => SecretCodec.SerializeSecretPayload(item);

    private static string RowJson(long id, string payload, int epoch, string updatedAt) =>
        $"{{\"id\":{id},\"payload\":{JsonSerializer.Serialize(payload)},\"key_epoch\":{epoch},\"updated_at\":{JsonSerializer.Serialize(updatedAt)}}}";

    /// <summary>路由器：GET kb_secrets 返回 rowsJson；POST/PATCH/DELETE 按需计数。</summary>
    private sealed class Router
    {
        public string RowsJson { get; set; } = "[]";
        public int PostCount { get; private set; }
        public int PatchCount { get; private set; }
        public int DeleteCount { get; private set; }
        public List<string> PatchedPayloads { get; } = new();

        public StubHttpHandler Handler { get; }

        public Router()
        {
            Handler = new StubHttpHandler(req =>
            {
                if (req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.EndsWith("/kb_secrets"))
                {
                    return Task.FromResult(Ok(RowsJson));
                }
                if (req.Method == HttpMethod.Post)
                {
                    PostCount++;
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Created) { Content = StringContent("[]") });
                }
                if (req.Method == HttpMethod.Patch)
                {
                    PatchCount++;
                    string bodyText = req.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
                    var body = JsonDocument.Parse(bodyText).RootElement;
                    PatchedPayloads.Add(body.GetProperty("payload").GetString()!);
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent));
                }
                if (req.Method == HttpMethod.Delete)
                {
                    DeleteCount++;
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent));
                }
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            });
        }

        private static HttpContent StringContent(string s) => new StringContent(s, System.Text.Encoding.UTF8, "application/json");
        private static HttpResponseMessage Ok(string s) => new(HttpStatusCode.OK) { Content = StringContent(s) };
    }

    private static VaultService Service(Router router) => new(new KbApi(new HttpClient(router.Handler), ApiBase));

    private static VaultItem Local(long id, string site, string updatedAt, params string[] tags)
        => new(id, site, "", "", "", "key-" + id, "", tags.ToList(), updatedAt);

    [Fact]
    public async Task RunSync_Pulls_New_Remote_Rows()
    {
        var router = new Router
        {
            RowsJson = "[" + RowJson(1, Kb1Crypto.EncryptToKb1(_key, SecretJson(new SecretItem("New", "", "", "", "k1", "", new List<string>()))), _epoch, "2026-10-01T00:00:00Z") + "]",
        };
        var service = Service(router);

        SyncResult result = await service.RunSyncAsync("uid-1", new List<VaultItem>());

        Assert.Equal(1, result.Pulled);
        Assert.Equal(0, result.Pushed);
        Assert.Empty(result.Conflicts);
        var item = Assert.Single(result.Items);
        Assert.Equal("New", item.Site);
        Assert.Equal("k1", item.Key);
    }

    [Fact]
    public async Task RunSync_Pushes_Local_Only_Rows()
    {
        var router = new Router(); // 服务端为空
        var service = Service(router);
        var local = new List<VaultItem> { Local(1, "Local", "2026-10-01T00:00:00Z") };

        SyncResult result = await service.RunSyncAsync("uid-1", local);

        Assert.Equal(1, result.Pushed);
        Assert.Equal(1, router.PostCount);
        Assert.Equal(0, result.Pulled);
        Assert.Contains(result.Items, i => i.Id == 1); // 本机版本先保留
    }

    [Fact]
    public async Task RunSync_Same_Timestamp_Keeps_Local_No_Conflict()
    {
        var router = new Router
        {
            RowsJson = "[" + RowJson(1, Kb1Crypto.EncryptToKb1(_key, SecretJson(new SecretItem("Remote", "", "", "", "r", "", new List<string>()))), _epoch, "2026-10-01T10:00:00Z") + "]",
        };
        var service = Service(router);
        // 本机 updated_at 与服务端等价（不同字符串但同一时刻）
        var local = new List<VaultItem> { Local(1, "Local", "2026-10-01T18:00:00+08:00") };

        SyncResult result = await service.RunSyncAsync("uid-1", local);

        Assert.Empty(result.Conflicts);
        Assert.Equal("Local", result.Items[0].Site); // 保留本机
    }

    [Fact]
    public async Task RunSync_Different_Timestamp_Reports_Conflict_Keeps_Local()
    {
        var router = new Router
        {
            RowsJson = "[" + RowJson(1, Kb1Crypto.EncryptToKb1(_key, SecretJson(new SecretItem("Remote", "", "", "", "r", "", new List<string>()))), _epoch, "2026-10-02T00:00:00Z") + "]",
        };
        var service = Service(router);
        var local = new List<VaultItem> { Local(1, "Local", "2026-10-01T00:00:00Z") };

        SyncResult result = await service.RunSyncAsync("uid-1", local);

        var conflict = Assert.Single(result.Conflicts);
        Assert.Equal(1, conflict.Id);
        Assert.Equal("2026-10-01T00:00:00Z", conflict.LocalUpdatedAt);
        Assert.Equal("2026-10-02T00:00:00Z", conflict.RemoteUpdatedAt);
        Assert.Equal("Local", result.Items[0].Site); // 未决前保留本机
    }

    [Fact]
    public async Task Resolve_UseRemote_Decrypts_Remote_Over_Local()
    {
        string remotePayload = Kb1Crypto.EncryptToKb1(_key, SecretJson(new SecretItem("Remote", "", "", "", "r-key", "", new List<string> { "t" })));
        var conflicts = new List<SyncConflict>
        {
            new(1, "Local", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", remotePayload, _epoch),
        };
        var router = new Router();
        var service = Service(router);
        var local = new List<VaultItem> { Local(1, "Local", "2026-10-01T00:00:00Z") };

        ResolveResult result = await service.ResolveConflictsAsync("uid-1", useRemote: true, conflicts, local);

        Assert.Equal(0, result.FailCount);
        Assert.Equal(0, router.PatchCount);
        var item = Assert.Single(result.Items);
        Assert.Equal("Remote", item.Site);
        Assert.Equal("r-key", item.Key);
        Assert.Equal(new List<string> { "t" }, item.Tags);
    }

    [Fact]
    public async Task Resolve_KeepLocal_Reencrypts_And_Patches()
    {
        string remotePayload = Kb1Crypto.EncryptToKb1(_key, SecretJson(new SecretItem("Remote", "", "", "", "r", "", new List<string>())));
        var conflicts = new List<SyncConflict>
        {
            new(1, "Local", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", remotePayload, _epoch),
        };
        var router = new Router();
        var service = Service(router);
        var local = new List<VaultItem> { Local(1, "Local", "2026-10-01T00:00:00Z") };

        ResolveResult result = await service.ResolveConflictsAsync("uid-1", useRemote: false, conflicts, local);

        Assert.Equal(0, result.FailCount);
        Assert.Equal(1, router.PatchCount);
        Assert.Equal("Local", result.Items[0].Site);
        // 上传的是重加密后的本机版本
        string uploaded = router.PatchedPayloads.Single();
        Assert.Equal("Local", SecretCodec.ParseSecretPayload(Kb1Crypto.DecryptFromKb1(_key, uploaded)).Site);
    }

    [Fact]
    public async Task Resolve_KeepLocal_Collects_Patch_Failures_Continues()
    {
        string p1 = Kb1Crypto.EncryptToKb1(_key, SecretJson(new SecretItem("R1", "", "", "", "r1", "", new List<string>())));
        string p2 = Kb1Crypto.EncryptToKb1(_key, SecretJson(new SecretItem("R2", "", "", "", "r2", "", new List<string>())));
        var conflicts = new List<SyncConflict>
        {
            new(1, "L1", "a", "b", p1, _epoch),
            new(2, "L2", "a", "b", p2, _epoch),
        };
        // PATCH 第 2 条失败（409），但继续处理第 1 条后的其余逻辑（此处即两条都尝试）
        int patchCount = 0;
        var patched = new List<string>();
        var handler = new StubHttpHandler(req =>
        {
            if (req.Method == HttpMethod.Patch)
            {
                patchCount++;
                string bodyText = req.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
                patched.Add(JsonDocument.Parse(bodyText).RootElement.GetProperty("payload").GetString()!);
                return Task.FromResult(patchCount == 2
                    ? new HttpResponseMessage(HttpStatusCode.Conflict)
                    : new HttpResponseMessage(HttpStatusCode.NoContent));
            }
            return req.Method == HttpMethod.Get
                ? Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("[]", System.Text.Encoding.UTF8, "application/json") })
                : Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent));
        });
        var service = new VaultService(new KbApi(new HttpClient(handler), ApiBase));
        var local = new List<VaultItem> { Local(1, "L1", "a"), Local(2, "L2", "a") };

        ResolveResult result = await service.ResolveConflictsAsync("uid-1", useRemote: false, conflicts, local);

        Assert.Equal(1, result.FailCount); // 第 2 条失败但继续处理
        Assert.Equal(2, patchCount); // 两条都尝试了
    }

    [Fact]
    public async Task ApplyTagChange_Rename_Updates_All_Affected_Rows()
    {
        var items = new List<VaultItem>
        {
            Local(1, "A", "t", "dev", "git"),
            Local(2, "B", "t", "dev"),
            Local(3, "C", "t", "other"),
        };
        var router = new Router();
        var service = Service(router);

        TagChangeResult result = await service.ApplyTagChangeAsync("uid-1", "dev", "开发", items);

        Assert.Equal(2, result.OkCount);
        Assert.Equal(2, router.PatchCount);
        Assert.Empty(result.Failures);
        // 重命名去重：item1 的 dev→开发 且 git 保留；item2 的 dev→开发
        var payloads = router.PatchedPayloads.Select(p => SecretCodec.ParseSecretPayload(Kb1Crypto.DecryptFromKb1(_key, p))).ToList();
        Assert.Equal(new List<string> { "开发", "git" }, payloads[0].Tags);
        Assert.Equal(new List<string> { "开发" }, payloads[1].Tags);
    }

    [Fact]
    public async Task ApplyTagChange_Delete_Removes_Tag_And_Omits_When_Empty()
    {
        var items = new List<VaultItem>
        {
            Local(1, "A", "t", "dev", "git"),
            Local(2, "B", "t", "dev"),
        };
        var router = new Router();
        var service = Service(router);

        TagChangeResult result = await service.ApplyTagChangeAsync("uid-1", "dev", null, items);

        Assert.Equal(2, result.OkCount);
        var payloads = router.PatchedPayloads.Select(p => SecretCodec.ParseSecretPayload(Kb1Crypto.DecryptFromKb1(_key, p))).ToList();
        Assert.Equal(new List<string> { "git" }, payloads[0].Tags);
        Assert.Empty(payloads[1].Tags); // tags 变空整键省略
        Assert.DoesNotContain("tags", Kb1Crypto.DecryptFromKb1(_key, router.PatchedPayloads[1]));
    }

    [Fact]
    public async Task ApplyTagChange_No_Match_Does_Not_Patch()
    {
        var router = new Router();
        var service = Service(router);

        TagChangeResult result = await service.ApplyTagChangeAsync("uid-1", "nonexistent", "x", new List<VaultItem> { Local(1, "A", "t") });

        Assert.Equal(0, result.OkCount);
        Assert.Equal(0, router.PatchCount);
    }

    [Fact]
    public void MapTags_Rename_Dedups_Preserving_Order()
    {
        Assert.Equal(new List<string> { "a", "b", "c" }, VaultService.MapTags(new List<string> { "a", "old", "b", "old", "c" }, "old", "a"));
        Assert.Equal(new List<string> { "a", "b" }, VaultService.MapTags(new List<string> { "old", "a", "b" }, "old", null));
    }

    [Fact]
    public void SameTimestamp_Handles_Format_Differences()
    {
        Assert.True(VaultService.SameTimestamp("2026-10-01T10:00:00Z", "2026-10-01T18:00:00+08:00"));
        Assert.False(VaultService.SameTimestamp("2026-10-01T10:00:00Z", "2026-10-02T10:00:00Z"));
        Assert.True(VaultService.SameTimestamp("garbage", "garbage")); // 原文相同
        Assert.False(VaultService.SameTimestamp("garbage", "other"));
    }
}
