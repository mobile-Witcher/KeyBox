using System.Net;
using KeyBox.Core.Auth;
using KeyBox.Core.Data;
using Xunit;

namespace KeyBox.Core.Tests;

/// <summary>RDB REST 契约测试：URL 拼装 / JSON 解析 / 错误映射（照安卓 KbApi.kt 形态）。</summary>
public class KbApiTests
{
    private const string ApiBase = "https://env-test-000000.api.tcloudbasegateway.com";

    private static KbApi Build(StubHttpHandler handler) => new(new HttpClient(handler), ApiBase);

    [Fact]
    public async Task FetchMyKeyInfo_Builds_Url_And_Parses()
    {
        var handler = StubHttpHandler.Json(_ =>
            """[{"kdf_salt":"c2FsdA==","kdf_verifier":"KB1:AAAA","key_epoch":3}]""");
        var api = Build(handler);

        KbUserInfo info = await api.FetchMyKeyInfoAsync("uid-42");

        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, req.Method);
        Assert.Equal(
            ApiBase + "/v1/rdb/rest/kb_users?select=kdf_salt,kdf_verifier,key_epoch&uid=eq.uid-42",
            req.Uri!.ToString());
        Assert.Equal("c2FsdA==", info.KdfSalt);
        Assert.Equal("KB1:AAAA", info.KdfVerifier);
        Assert.Equal(3, info.KeyEpoch);
    }

    [Fact]
    public async Task FetchMyKeyInfo_Url_Encodes_Uid()
    {
        var handler = StubHttpHandler.Json(_ => "[]");
        var api = Build(handler);

        await Assert.ThrowsAsync<AuthApiException>(() => api.FetchMyKeyInfoAsync("weird uid/with@chars"));

        // uid 必须逐段百分号编码，否则空格/斜杠/@ 会破坏 PostgREST 查询结构
        string absoluteUri = handler.Requests.Single().Uri!.AbsoluteUri;
        Assert.Contains("uid=eq.", absoluteUri);
        Assert.Contains("%20", absoluteUri); // 空格
        Assert.Contains("%2F", absoluteUri); // 斜杠
        Assert.Contains("%40", absoluteUri); // @
        Assert.DoesNotContain("uid=eq.weird uid", absoluteUri);
    }

    [Fact]
    public async Task FetchMyKeyInfo_Empty_Rows_Throws()
    {
        var handler = StubHttpHandler.Json(_ => "[]");
        var api = Build(handler);

        var ex = await Assert.ThrowsAsync<AuthApiException>(() => api.FetchMyKeyInfoAsync("uid-1"));
        Assert.Contains("账号不存在", ex.Message);
    }

    [Fact]
    public async Task FetchSecretRows_Builds_Url_And_Parses()
    {
        var handler = StubHttpHandler.Json(_ =>
            """[{"id":11,"payload":"KB1:abc","key_epoch":3,"updated_at":"2026-09-30T10:00:00Z"},{"id":12,"payload":"KB1:def","key_epoch":3,"updated_at":"2026-09-30T09:00:00Z"}]""");
        var api = Build(handler);

        List<KbSecretRow> rows = await api.FetchSecretRowsAsync("uid-42");

        var req = Assert.Single(handler.Requests);
        Assert.Equal(
            ApiBase + "/v1/rdb/rest/kb_secrets?select=id,payload,key_epoch,updated_at&owner_id=eq.uid-42&order=updated_at.desc",
            req.Uri!.ToString());

        Assert.Equal(2, rows.Count);
        Assert.Equal(11, rows[0].Id);
        Assert.Equal("KB1:abc", rows[0].Payload);
        Assert.Equal(3, rows[0].KeyEpoch);
        Assert.Equal("2026-09-30T10:00:00Z", rows[0].UpdatedAt);
        Assert.Equal(12, rows[1].Id);
    }

    [Fact]
    public async Task FetchSecretRows_Empty_Array_Ok()
    {
        var handler = StubHttpHandler.Json(_ => "[]");
        var api = Build(handler);

        List<KbSecretRow> rows = await api.FetchSecretRowsAsync("uid-1");
        Assert.Empty(rows);
    }

    [Fact]
    public async Task Http_Error_Throws_AuthException()
    {
        var handler = StubHttpHandler.Json(_ => "{\"message\":\"denied\"}", HttpStatusCode.Forbidden);
        var api = Build(handler);

        var ex = await Assert.ThrowsAsync<AuthException>(() => api.FetchMyKeyInfoAsync("uid-1"));
        Assert.Contains("403", ex.Message);
        Assert.False(ex.RecoverableByRelogin);
    }

    [Fact]
    public async Task Invalid_Json_Throws_AuthApiException()
    {
        var handler = StubHttpHandler.Json(_ => "{not json");
        var api = Build(handler);

        await Assert.ThrowsAsync<AuthApiException>(() => api.FetchSecretRowsAsync("uid-1"));
    }
}
