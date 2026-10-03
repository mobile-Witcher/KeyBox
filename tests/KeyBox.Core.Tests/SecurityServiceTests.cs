using System.Net;
using System.Text;
using System.Text.Json;
using KeyBox.Core.Crypto;
using KeyBox.Core.Data;
using KeyBox.Core.Vault;
using Xunit;

namespace KeyBox.Core.Tests;

/// <summary>R21 改主密码（事务性）/ R28 恢复码 / R29 备份 服务测试。</summary>
public class SecurityServiceTests : IDisposable
{
    private const string ApiBase = "https://env-test-000000.api.tcloudbasegateway.com";
    private readonly string _oldPassword = "old-password-123";
    private readonly string _oldSalt;
    private readonly byte[] _oldKey;
    private readonly int _epoch = 4;

    public SecurityServiceTests()
    {
        _oldSalt = Kb1Crypto.GenerateSaltB64();
        _oldKey = Kb1Crypto.DeriveKey(_oldPassword, _oldSalt);
    }

    public void Dispose()
    {
        MasterKeySession.Clear();
    }

    private KbMyRole Role(string recoverySalt = "", string recoveryBlob = "")
        => new("user", "active", _oldSalt, Kb1Crypto.EncryptToKb1(_oldKey, UnlockService.VerifierPlaintext), _epoch,
            recoverySalt, recoveryBlob, "");

    private static string SecretJson(SecretItem s) => SecretCodec.SerializeSecretPayload(s);

    private static string RowsJson(params (long id, string payload, int epoch)[] rows)
        => "[" + string.Join(",", rows.Select(r =>
            $"{{\"id\":{r.id},\"payload\":{JsonSerializer.Serialize(r.payload)},\"key_epoch\":{r.epoch},\"updated_at\":\"2026-10-01T00:00:00Z\"}}")) + "]";

    /// <summary>可配置的假服务端：GET 返回 rows；kbRotateMaster 捕获 body 返回 {ok,data:{keyEpoch}}。</summary>
    private sealed class RotateRouter
    {
        public string RowsJson { get; set; } = "[]";
        public int NextEpoch { get; set; } = 5;
        public bool FailRotate { get; set; }
        public int RotateCallCount;
        public List<string> RotateBodies { get; } = new();
        public List<string> InsertedPayloads { get; } = new();

        public StubHttpHandler Handler { get; }

        public RotateRouter()
        {
            Handler = new StubHttpHandler(req =>
            {
                string path = req.RequestUri!.AbsolutePath;
                if (req.Method == HttpMethod.Get && path.EndsWith("/kb_secrets"))
                {
                    return Task.FromResult(Ok(RowsJson));
                }
                if (req.Method == HttpMethod.Post && path.EndsWith("/kbRotateMaster"))
                {
                    RotateCallCount++;
                    string body = req.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
                    RotateBodies.Add(body);
                    if (FailRotate)
                    {
                        return Task.FromResult(Ok("{\"ok\":false,\"error\":\"rotate failed\"}"));
                    }
                    return Task.FromResult(Ok("{\"ok\":true,\"data\":{\"keyEpoch\":" + NextEpoch + "}}"));
                }
                if (req.Method == HttpMethod.Post && path.EndsWith("/kbGetMyRole"))
                {
                    return Task.FromResult(Ok("{\"ok\":true,\"data\":{}}"));
                }
                if (req.Method == HttpMethod.Post && path.EndsWith("/kbAckRecovery"))
                {
                    return Task.FromResult(Ok("{\"ok\":true,\"data\":{\"ackedAt\":\"2026-10-02T00:00:00Z\"}}"));
                }
                if (req.Method == HttpMethod.Post && path.EndsWith("/kb_secrets"))
                {
                    string body = req.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
                    InsertedPayloads.Add(JsonDocument.Parse(body).RootElement.GetProperty("payload").GetString()!);
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Created) { Content = Json("[]") });
                }
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            });
        }

        private static HttpContent Json(string s) => new StringContent(s, Encoding.UTF8, "application/json");
        private static HttpResponseMessage Ok(string s) => new(HttpStatusCode.OK) { Content = Json(s) };
    }

    private static SecurityService Service(RotateRouter router)
        => new(new KbApi(new HttpClient(router.Handler), ApiBase));

    // ---- R21 改主密码 ----

    [Fact]
    public async Task Rotate_Success_Reencrypts_With_New_Key_And_Updates_Session()
    {
        MasterKeySession.Set(_oldKey, _epoch);
        var router = new RotateRouter
        {
            NextEpoch = 5,
            RowsJson = RowsJson(
                (1, Kb1Crypto.EncryptToKb1(_oldKey, SecretJson(new SecretItem("A", "", "", "", "k1", "", new List<string>()))), _epoch),
                (2, Kb1Crypto.EncryptToKb1(_oldKey, SecretJson(new SecretItem("B", "", "", "", "k2", "", new List<string>()))), _epoch)),
        };
        var service = Service(router);

        RotateResult result = await service.RotateMasterAsync("uid-1", _oldPassword, "brand-new-password", "", Role());

        Assert.Equal(5, result.NewKeyEpoch);
        Assert.Equal(2, result.ItemCount);
        Assert.Equal(5, MasterKeySession.KeyEpoch);

        // 提交的 items 必须能用【新】主密钥解开（派生自 body 里的新 salt）
        var body = JsonDocument.Parse(router.RotateBodies.Single()).RootElement;
        string newSalt = body.GetProperty("kdfSalt").GetString()!;
        byte[] newKey = Kb1Crypto.DeriveKey("brand-new-password", newSalt);
        var items = body.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(2, items.Count);
        // new verifier 必须是新 key 加密的固定串
        string newVerifier = body.GetProperty("kdfVerifier").GetString()!;
        Assert.Equal("KeyBox-Verify", Kb1Crypto.DecryptFromKb1(newKey, newVerifier));
        // 每一条重加密密文都能用新 key 解回原明文
        foreach (var it in items)
        {
            string plain = Kb1Crypto.DecryptFromKb1(newKey, it.GetProperty("payload").GetString()!);
            Assert.Contains("\"site\"", plain);
        }
        // 内存主密钥已更新为新 key
        Assert.Equal(newKey, MasterKeySession.MasterKeyRaw());
    }

    [Fact]
    public async Task Rotate_Wrong_Old_Password_Aborts_No_Submit()
    {
        MasterKeySession.Set(_oldKey, _epoch);
        var router = new RotateRouter();
        var service = Service(router);

        var ex = await Assert.ThrowsAsync<UnlockException>(
            () => service.RotateMasterAsync("uid-1", "wrong-old-password", "brand-new-password", "", Role()));

        Assert.Equal("原主密码不正确。", ex.Message);
        Assert.Equal(0, router.RotateCallCount); // 未提交
        Assert.Equal(_epoch, MasterKeySession.KeyEpoch); // 代数未变
    }

    [Fact]
    public async Task Rotate_One_Undecryptable_Row_Aborts_Whole_Operation()
    {
        MasterKeySession.Set(_oldKey, _epoch);
        // 第 2 条用另一个 key 加密 → 无法用旧主密码解开
        byte[] otherKey = Kb1Crypto.DeriveKey("another-password", Kb1Crypto.GenerateSaltB64());
        var router = new RotateRouter
        {
            RowsJson = RowsJson(
                (1, Kb1Crypto.EncryptToKb1(_oldKey, SecretJson(new SecretItem("A", "", "", "", "k1", "", new List<string>()))), _epoch),
                (2, Kb1Crypto.EncryptToKb1(otherKey, SecretJson(new SecretItem("B", "", "", "", "k2", "", new List<string>()))), _epoch)),
        };
        var service = Service(router);

        var ex = await Assert.ThrowsAsync<UnlockException>(
            () => service.RotateMasterAsync("uid-1", _oldPassword, "brand-new-password", "", Role()));

        Assert.Contains("整体中止", ex.Message);
        Assert.Contains("第 2 条", ex.Message);
        Assert.Equal(0, router.RotateCallCount); // 绝不半新半旧：未提交
    }

    [Fact]
    public async Task Rotate_Server_Failure_Attempts_Rollback()
    {
        MasterKeySession.Set(_oldKey, _epoch);
        var router = new RotateRouter { FailRotate = true };
        var service = Service(router);

        var ex = await Assert.ThrowsAsync<UnlockException>(
            () => service.RotateMasterAsync("uid-1", _oldPassword, "brand-new-password", "", Role()));

        Assert.Contains("已尝试回滚", ex.Message);
        Assert.Equal(2, router.RotateCallCount); // 提交 + 回滚
        Assert.Equal(_epoch, MasterKeySession.KeyEpoch); // 未被改成新代数
    }

    [Fact]
    public async Task Rotate_New_Password_Too_Short_Rejected()
    {
        MasterKeySession.Set(_oldKey, _epoch);
        var service = Service(new RotateRouter());

        await Assert.ThrowsAsync<UnlockException>(
            () => service.RotateMasterAsync("uid-1", _oldPassword, "short", "", Role()));
    }

    [Fact]
    public async Task Rotate_With_Recovery_Rewraps_Using_New_Key()
    {
        MasterKeySession.Set(_oldKey, _epoch);
        string recoverySalt = "cmVjb3ZlcnlzYWx0MTIzNDU2Nzg=";
        string recoveryBlob = KbRecovery.WrapMasterKeyWithRecovery(
            "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-2Y3Z-4567", recoverySalt, _oldSalt, _oldKey);
        var router = new RotateRouter { NextEpoch = 9 };
        var service = Service(router);

        await service.RotateMasterAsync("uid-1", _oldPassword, "brand-new-password",
            "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-2Y3Z-4567", Role(recoverySalt, recoveryBlob));

        var body = JsonDocument.Parse(router.RotateBodies.Single()).RootElement;
        string newBlob = body.GetProperty("recoveryBlob").GetString()!;
        Assert.StartsWith("KBRC1:", newBlob);
        // 新 blob 能用恢复码解出【新】主密钥
        string newSalt = body.GetProperty("kdfSalt").GetString()!;
        byte[] newKey = Kb1Crypto.DeriveKey("brand-new-password", newSalt);
        byte[] unwrapped = KbRecovery.UnwrapMasterKeyWithRecovery(
            "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-2Y3Z-4567", recoverySalt, newBlob);
        Assert.Equal(newKey, unwrapped);
    }

    // ---- R29 导出 ----

    [Fact]
    public async Task Export_Decrypts_All_And_Skips_Failures()
    {
        MasterKeySession.Set(_oldKey, _epoch);
        byte[] otherKey = Kb1Crypto.DeriveKey("x", Kb1Crypto.GenerateSaltB64());
        var router = new RotateRouter
        {
            RowsJson = RowsJson(
                (1, Kb1Crypto.EncryptToKb1(_oldKey, SecretJson(new SecretItem("A", "u", "w", "m", "k1", "n", new List<string> { "t" }))), _epoch),
                (2, Kb1Crypto.EncryptToKb1(otherKey, SecretJson(new SecretItem("B", "", "", "", "k2", "", new List<string>()))), _epoch), // 解密失败
                (3, Kb1Crypto.EncryptToKb1(_oldKey, SecretJson(new SecretItem("C", "", "", "", "k3", "", new List<string>()))), _epoch - 1)), // 代数不符
        };
        var service = new SecurityService(new KbApi(new HttpClient(router.Handler), ApiBase));

        ExportResult result = await service.PrepareExportAsync("uid-1");

        Assert.Equal(1, result.Count);
        Assert.Equal(2, result.Skipped);
        ParsedBackup parsed = BackupCodec.Decode(result.Json);
        Assert.Equal("A", parsed.Items[0].Site);
        Assert.Equal("k1", parsed.Items[0].Key);
    }

    // ---- R29 导入 ----

    [Fact]
    public async Task Import_Parses_Encrypts_And_Inserts_Each()
    {
        MasterKeySession.Set(_oldKey, _epoch);
        var router = new RotateRouter();
        var service = new SecurityService(new KbApi(new HttpClient(router.Handler), ApiBase));

        string backup = BackupCodec.Encode("2026-10-02T00:00:00Z", new List<BackupItem>
        {
            new("A", "u", "w", "m", "k1", "n", new List<string> { "t" }, "2026-10-01T00:00:00Z"),
            new("B", "", "", "", "k2", "", new List<string>(), "2026-10-01T00:00:00Z"),
        });

        ImportResult result = await service.ImportAsync("uid-1", backup);

        Assert.Equal(2, result.Imported);
        Assert.Equal(0, result.Skipped);
        Assert.Equal(2, router.InsertedPayloads.Count);
        // 插入的密文可用当前主密钥解回
        foreach (string payload in router.InsertedPayloads)
        {
            string plain = Kb1Crypto.DecryptFromKb1(_oldKey, payload);
            Assert.Contains("\"site\"", plain);
        }
    }

    [Fact]
    public async Task Import_Without_Unlock_Throws()
    {
        MasterKeySession.Clear();
        var service = new SecurityService(new KbApi(new HttpClient(new RotateRouter().Handler), ApiBase));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ImportAsync("uid-1", "{\"items\":[]}"));
    }
}
