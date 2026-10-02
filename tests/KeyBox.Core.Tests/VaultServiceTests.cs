using System.Text.Json;
using KeyBox.Core.Crypto;
using KeyBox.Core.Data;
using KeyBox.Core.Vault;
using Xunit;

namespace KeyBox.Core.Tests;

public class VaultServiceTests : IDisposable
{
    private const string ApiBase = "https://env-test-000000.api.tcloudbasegateway.com";
    private readonly string _password = "vault-test-password";
    private readonly string _salt;
    private readonly byte[] _key;
    private readonly int _epoch = 5;

    public VaultServiceTests()
    {
        _salt = Kb1Crypto.GenerateSaltB64();
        _key = Kb1Crypto.DeriveKey(_password, _salt);
    }

    public void Dispose()
    {
        MasterKeySession.Clear();
    }

    private static string SecretJson(SecretItem item)
    {
        var payload = new Dictionary<string, object?>
        {
            ["site"] = item.Site,
            ["url"] = item.Url,
            ["website"] = item.Website,
            ["model"] = item.Model,
            ["key"] = item.Key,
            ["note"] = item.Note,
        };
        if (item.Tags.Count > 0) payload["tags"] = item.Tags;
        return JsonSerializer.Serialize(payload);
    }

    private static KbSecretRow Row(long id, string payload, int epoch, string updatedAt = "2026-09-30T10:00:00Z")
        => new(id, payload, epoch, updatedAt);

    private VaultService ServiceWith(params KbSecretRow[] rows)
    {
        string body = JsonSerializer.Serialize(rows.Select(r => new
        {
            id = r.Id,
            payload = r.Payload,
            key_epoch = r.KeyEpoch,
            updated_at = r.UpdatedAt,
        }));
        var handler = StubHttpHandler.Json(_ => body);
        return new VaultService(new KbApi(new HttpClient(handler), ApiBase));
    }

    [Fact]
    public async Task FetchAndDecrypt_Decrypts_All_Fields()
    {
        MasterKeySession.Set(_key, _epoch);
        var secret = new SecretItem("GitHub", "https://github.com", "github.com", "PAT", "ghp_secret123", "备注", new List<string> { "dev", "git" });
        var service = ServiceWith(Row(1, Kb1Crypto.EncryptToKb1(_key, SecretJson(secret)), _epoch));

        List<VaultItem> items = await service.FetchAndDecryptAsync("uid-1");

        var item = Assert.Single(items);
        Assert.False(item.DecryptError);
        Assert.Equal(1, item.Id);
        Assert.Equal("GitHub", item.Site);
        Assert.Equal("https://github.com", item.Url);
        Assert.Equal("github.com", item.Website);
        Assert.Equal("PAT", item.Model);
        Assert.Equal("ghp_secret123", item.Key);
        Assert.Equal("备注", item.Note);
        Assert.Equal(new List<string> { "dev", "git" }, item.Tags);
        Assert.Equal("2026-09-30T10:00:00Z", item.UpdatedAt);
    }

    [Fact]
    public async Task FetchAndDecrypt_Epoch_Mismatch_Marks_Error_Not_Break_Table()
    {
        MasterKeySession.Set(_key, _epoch);
        var good = Row(1, Kb1Crypto.EncryptToKb1(_key, SecretJson(new SecretItem("A", "", "", "", "k1", "", new List<string>()))), _epoch);
        var stale = Row(2, Kb1Crypto.EncryptToKb1(_key, SecretJson(new SecretItem("B", "", "", "", "k2", "", new List<string>()))), _epoch - 1);

        List<VaultItem> items = await ServiceWith(good, stale).FetchAndDecryptAsync("uid-1");

        Assert.Equal(2, items.Count);
        Assert.False(items[0].DecryptError);
        Assert.True(items[1].DecryptError);
        Assert.Contains("代数", items[1].DecryptErrMsg);
    }

    [Fact]
    public async Task FetchAndDecrypt_Tampered_Payload_Marks_Error()
    {
        MasterKeySession.Set(_key, _epoch);
        string kb1 = Kb1Crypto.EncryptToKb1(_key, "{\"site\":\"X\"}");
        // 篡改 payload
        byte[] boxed = Convert.FromBase64String(kb1["KB1:".Length..]);
        boxed[^1] ^= 0x01;
        string tampered = "KB1:" + Convert.ToBase64String(boxed);

        List<VaultItem> items = await ServiceWith(Row(1, tampered, _epoch)).FetchAndDecryptAsync("uid-1");

        var item = Assert.Single(items);
        Assert.True(item.DecryptError);
        Assert.NotEmpty(item.DecryptErrMsg);
    }

    [Fact]
    public async Task FetchAndDecrypt_Invalid_Plain_Json_Marks_Error()
    {
        MasterKeySession.Set(_key, _epoch);
        string payload = Kb1Crypto.EncryptToKb1(_key, "{not json");

        List<VaultItem> items = await ServiceWith(Row(1, payload, _epoch)).FetchAndDecryptAsync("uid-1");

        var item = Assert.Single(items);
        Assert.True(item.DecryptError);
    }

    [Fact]
    public async Task FetchAndDecrypt_Without_Unlock_Throws()
    {
        MasterKeySession.Clear();
        var service = ServiceWith();

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.FetchAndDecryptAsync("uid-1"));
    }
}
