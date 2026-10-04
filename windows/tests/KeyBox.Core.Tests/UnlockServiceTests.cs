using KeyBox.Core.Crypto;
using KeyBox.Core.Data;
using KeyBox.Core.Vault;
using Xunit;

namespace KeyBox.Core.Tests;

public class UnlockServiceTests : IDisposable
{
    private const string ApiBase = "https://env-test-000000.api.tcloudbasegateway.com";

    public void Dispose()
    {
        MasterKeySession.Clear();
    }

    /// <summary>构造一组真实密钥参数（派生 + verifier 加密），供假服务端返回。</summary>
    private static (string SaltB64, string Verifier, byte[] Key) MakeKeyInfo(string password)
    {
        string salt = Kb1Crypto.GenerateSaltB64();
        byte[] key = Kb1Crypto.DeriveKey(password, salt);
        string verifier = Kb1Crypto.EncryptToKb1(key, UnlockService.VerifierPlaintext);
        return (salt, verifier, key);
    }

    private static KbApi StubApi(string salt, string verifier, int epoch)
    {
        var handler = StubHttpHandler.Json(_ =>
            "[{\"kdf_salt\":\"" + salt + "\",\"kdf_verifier\":\"" + verifier + "\",\"key_epoch\":" + epoch + "}]");
        return new KbApi(new HttpClient(handler), ApiBase);
    }

    [Fact]
    public async Task UnlockWithPassword_Correct_Sets_MasterKeySession()
    {
        var (salt, verifier, key) = MakeKeyInfo("correct-password");
        var service = new UnlockService(StubApi(salt, verifier, 7));

        await service.UnlockWithPasswordAsync("uid-1", "correct-password");

        Assert.True(MasterKeySession.IsUnlocked);
        Assert.Equal(7, MasterKeySession.KeyEpoch);
        Assert.Equal(key, MasterKeySession.MasterKeyRaw());
    }

    [Fact]
    public async Task UnlockWithPassword_Wrong_Throws_Generic_And_No_Session()
    {
        var (salt, verifier, _) = MakeKeyInfo("correct-password");
        var service = new UnlockService(StubApi(salt, verifier, 7));

        var ex = await Assert.ThrowsAsync<UnlockException>(
            () => service.UnlockWithPasswordAsync("uid-1", "wrong-password"));

        Assert.Equal("主密码错误", ex.Message);
        Assert.False(MasterKeySession.IsUnlocked);
    }

    [Fact]
    public async Task UnlockWithPassword_Corrupt_Verifier_Throws_Generic()
    {
        // verifier 不是合法 KB1（例如被改坏）→ 统一归为密码错误
        var service = new UnlockService(StubApi("c2FsdA==", "KB1:!!!!bad", 7));

        var ex = await Assert.ThrowsAsync<UnlockException>(
            () => service.UnlockWithPasswordAsync("uid-1", "any-password"));
        Assert.Equal("主密码错误", ex.Message);
        Assert.False(MasterKeySession.IsUnlocked);
    }

    [Fact]
    public async Task UnlockWithPassword_Empty_Password_Throws_Generic()
    {
        var (salt, verifier, _) = MakeKeyInfo("p");
        var service = new UnlockService(StubApi(salt, verifier, 7));

        var ex = await Assert.ThrowsAsync<UnlockException>(
            () => service.UnlockWithPasswordAsync("uid-1", ""));
        Assert.Equal("主密码错误", ex.Message);
    }

    [Fact]
    public async Task UnlockWithPassword_Fetch_Error_Propagates_Not_PasswordError()
    {
        var handler = StubHttpHandler.Json(_ => "[]"); // 空行 → AuthApiException
        var service = new UnlockService(new KbApi(new HttpClient(handler), ApiBase));

        await Assert.ThrowsAsync<KeyBox.Core.Auth.AuthApiException>(
            () => service.UnlockWithPasswordAsync("uid-1", "p"));
        Assert.False(MasterKeySession.IsUnlocked);
    }

    [Fact]
    public async Task FetchKeyEpoch_Returns_Server_Epoch()
    {
        var (salt, verifier, _) = MakeKeyInfo("p");
        var service = new UnlockService(StubApi(salt, verifier, 11));

        int epoch = await service.FetchKeyEpochAsync("uid-1");
        Assert.Equal(11, epoch);
    }
}
