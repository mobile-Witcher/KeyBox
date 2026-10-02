using System.Net;
using System.Text;
using System.Text.Json;
using KeyBox.Core.Auth;
using KeyBox.Core.Crypto;
using KeyBox.Core.Data;
using KeyBox.Core.Vault;
using Xunit;

namespace KeyBox.Core.Tests;

public class VaultServiceCrudTests : IDisposable
{
    private const string ApiBase = "https://env-test-000000.api.tcloudbasegateway.com";
    private readonly byte[] _key;
    private readonly int _epoch = 5;

    public VaultServiceCrudTests()
    {
        string salt = Kb1Crypto.GenerateSaltB64();
        _key = Kb1Crypto.DeriveKey("crud-password", salt);
        MasterKeySession.Set(_key, _epoch);
    }

    public void Dispose()
    {
        MasterKeySession.Clear();
    }

    private static VaultService ServiceWith(StubHttpHandler handler)
        => new(new KbApi(new HttpClient(handler), ApiBase));

    [Fact]
    public async Task Create_Encrypts_And_Posts()
    {
        var handler = StubHttpHandler.Json(req =>
            req.Method == HttpMethod.Post ? "[]" : "[]", HttpStatusCode.Created);
        var service = ServiceWith(handler);

        await service.CreateAsync(new SecretItem("OpenAI", "https://api.openai.com/v1", "platform.openai.com", "gpt-4o", "sk-abc", "note", new List<string> { "ai" }));

        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, req.Method);
        var body = JsonDocument.Parse(req.Body).RootElement;
        string payload = body.GetProperty("payload").GetString()!;
        Assert.Equal(_epoch, body.GetProperty("key_epoch").GetInt32());
        Assert.StartsWith("KB1:", payload);

        // 密文可解回原明文
        string plain = Kb1Crypto.DecryptFromKb1(_key, payload);
        SecretItem item = SecretCodec.ParseSecretPayload(plain);
        Assert.Equal("OpenAI", item.Site);
        Assert.Equal("gpt-4o", item.Model);
        Assert.Equal(new List<string> { "ai" }, item.Tags);
    }

    [Fact]
    public async Task Update_Reencrypts_And_Patches()
    {
        var handler = StubHttpHandler.Json(_ => "[]", HttpStatusCode.NoContent);
        var service = ServiceWith(handler);

        await service.UpdateAsync(42, new SecretItem("GitHub", "", "github.com", "", "ghp_new", "", new List<string> { "dev" }));

        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Patch, req.Method);
        Assert.EndsWith("/v1/rdb/rest/kb_secrets?id=eq.42", req.Uri!.ToString());
        var body = JsonDocument.Parse(req.Body).RootElement;
        Assert.Equal(_epoch, body.GetProperty("key_epoch").GetInt32());
        Assert.Contains("updated_at", req.Body);
        string plain = Kb1Crypto.DecryptFromKb1(_key, body.GetProperty("payload").GetString()!);
        Assert.Equal("ghp_new", SecretCodec.ParseSecretPayload(plain).Key);
    }

    [Fact]
    public async Task Delete_Deletes()
    {
        var handler = StubHttpHandler.Json(_ => "[]", HttpStatusCode.NoContent);
        var service = ServiceWith(handler);

        await service.DeleteAsync(7);

        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Delete, req.Method);
        Assert.EndsWith("/v1/rdb/rest/kb_secrets?id=eq.7", req.Uri!.ToString());
    }

    [Fact]
    public async Task Update_409_Propagates_EpochChanged()
    {
        var handler = StubHttpHandler.Json(_ => "{}", HttpStatusCode.Conflict);
        var service = ServiceWith(handler);

        var ex = await Assert.ThrowsAsync<AuthApiException>(
            () => service.UpdateAsync(1, new SecretItem("A", "", "", "", "k", "", new List<string>())));
        Assert.Equal("密钥代数已变化，请先同步", ex.Message);
    }

    [Fact]
    public async Task Create_Without_Unlock_Throws()
    {
        MasterKeySession.Clear();
        var service = ServiceWith(StubHttpHandler.Json(_ => "[]", HttpStatusCode.Created));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.CreateAsync(new SecretItem("A", "", "", "", "k", "", new List<string>())));
    }
}
