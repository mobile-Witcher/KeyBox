using System.Net;
using System.Text.Json;
using KeyBox.Core.Auth;
using Xunit;

namespace KeyBox.Core.Tests;

/// <summary>
/// 登录 / 会话 HTTP 契约测试（照抄安卓 AuthRepository.kt 与鸿蒙 auth.ets 的实测形态）。
/// 用假 Handler 逐条断言：路径、JSON 字段、Authorization 头、刷新端点无 Authorization 头。
/// </summary>
public class AuthRepositoryContractTests
{
    private const string EnvId = "env-test-000000";
    private const string Pk = "pk-test-token";

    private static AuthRepository Build(StubHttpHandler handler) => new(new HttpClient(handler), EnvId, Pk);

    [Fact]
    public async Task SendVerification_Sends_Phone_And_Publishable_Bearer()
    {
        var handler = StubHttpHandler.Json(_ => "{\"verification_id\":\"vid-abc\"}");
        var repo = Build(handler);

        string vid = await repo.SendVerificationAsync("13800138000");

        Assert.Equal("vid-abc", vid);
        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, req.Method);
        Assert.Equal($"https://{EnvId}.api.tcloudbasegateway.com/auth/v1/verification", req.Uri!.ToString());
        Assert.Equal("Bearer " + Pk, req.Authorization!.ToString());
        Assert.Equal("@cloudbase/js-sdk/3.10.1", req.Header("X-SDK-Version"));
        Assert.Equal("{\"phone_number\":\"+86 13800138000\"}", req.Body);
    }

    [Fact]
    public async Task SendVerification_Normalizes_Phone_Without_CountryCode()
    {
        var handler = StubHttpHandler.Json(_ => "{\"verification_id\":\"vid-1\"}");
        var repo = Build(handler);

        await repo.SendVerificationAsync("13800138000");
        Assert.Equal("{\"phone_number\":\"+86 13800138000\"}", handler.Requests.Single().Body);
    }

    [Fact]
    public void NormalizePhone_Keeps_Phone_With_CountryCode()
    {
        Assert.Equal("+86 13800138000", AuthRepository.NormalizePhone("+86 13800138000"));
        Assert.Equal("+1 4155552671", AuthRepository.NormalizePhone("+1 4155552671"));
        Assert.Equal("+86 13800138000", AuthRepository.NormalizePhone(" 13800138000 "));
    }

    [Fact]
    public async Task VerifyCode_Sends_VerificationId_And_Code()
    {
        var handler = StubHttpHandler.Json(_ => "{\"verification_token\":\"vt-xyz\"}");
        var repo = Build(handler);

        string token = await repo.VerifyCodeAsync("vid-abc", "123456");

        Assert.Equal("vt-xyz", token);
        var req = Assert.Single(handler.Requests);
        Assert.Equal("https://" + EnvId + ".api.tcloudbasegateway.com/auth/v1/verification/verify", req.Uri!.ToString());
        Assert.Equal("Bearer " + Pk, req.Authorization!.ToString());
        Assert.Equal("{\"verification_id\":\"vid-abc\",\"verification_code\":\"123456\"}", req.Body);
    }

    [Fact]
    public async Task SignIn_Parses_Session_From_Response()
    {
        var handler = StubHttpHandler.Json(_ => TestJson.Session("acc-1", "ref-1", 7200, "uid-42"));
        var repo = Build(handler);

        Session session = await repo.SignInAsync("vt-xyz");

        var req = Assert.Single(handler.Requests);
        Assert.Equal("https://" + EnvId + ".api.tcloudbasegateway.com/auth/v1/signin", req.Uri!.ToString());
        Assert.Equal("{\"verification_token\":\"vt-xyz\"}", req.Body);

        Assert.Equal("acc-1", session.AccessToken);
        Assert.Equal("ref-1", session.RefreshToken);
        Assert.Equal(7200, session.ExpiresIn);
        Assert.Equal("uid-42", session.Uid);
    }

    [Fact]
    public async Task RefreshSession_Has_No_Authorization_Header_And_Sends_Refresh_Body()
    {
        var handler = StubHttpHandler.Json(_ => TestJson.Session("acc-2", "ref-2", 7200, "uid-42"));
        var repo = Build(handler);

        Session session = await repo.RefreshSessionAsync("old-refresh-token");

        var req = Assert.Single(handler.Requests);
        Assert.Equal("https://" + EnvId + ".api.tcloudbasegateway.com/auth/v1/token", req.Uri!.ToString());
        // 硬约束：/auth/v1/token 不得带任何 Authorization 头
        Assert.Null(req.Authorization);
        Assert.Null(req.Header("Authorization"));

        var body = JsonDocument.Parse(req.Body).RootElement;
        Assert.Equal(EnvId, body.GetProperty("client_id").GetString());
        Assert.Equal("", body.GetProperty("client_secret").GetString());
        Assert.Equal("refresh_token", body.GetProperty("grant_type").GetString());
        Assert.Equal("old-refresh-token", body.GetProperty("refresh_token").GetString());

        Assert.Equal("acc-2", session.AccessToken);
        Assert.Equal("ref-2", session.RefreshToken);
    }

    [Fact]
    public async Task RefreshSession_Falls_Back_To_Old_RefreshToken_When_Absent_In_Response()
    {
        var handler = StubHttpHandler.Json(_ => "{\"access_token\":\"acc-3\",\"expires_in\":7200,\"sub\":\"u1\"}");
        var repo = Build(handler);

        Session session = await repo.RefreshSessionAsync("old-refresh-token");

        Assert.Equal("old-refresh-token", session.RefreshToken);
    }

    [Fact]
    public async Task RefreshSession_Failure_Is_RecoverableByRelogin()
    {
        var handler = StubHttpHandler.Json(_ => "{}", HttpStatusCode.Unauthorized);
        var repo = Build(handler);

        var ex = await Assert.ThrowsAsync<AuthException>(() => repo.RefreshSessionAsync("expired"));
        Assert.True(ex.RecoverableByRelogin);
        Assert.Contains("刷新会话失败", ex.Message);
    }

    [Fact]
    public async Task SendVerification_Empty_Id_Throws()
    {
        var handler = StubHttpHandler.Json(_ => "{\"foo\":\"bar\"}");
        var repo = Build(handler);

        await Assert.ThrowsAsync<AuthException>(() => repo.SendVerificationAsync("13800138000"));
    }
}
