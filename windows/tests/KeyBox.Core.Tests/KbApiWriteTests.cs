using System.Net;
using System.Text.Json;
using KeyBox.Core.Auth;
using KeyBox.Core.Data;
using Xunit;

namespace KeyBox.Core.Tests;

/// <summary>RDB 写操作契约测试：POST/PATCH/DELETE 路径与 body、409 代数冲突映射（照安卓 KbApi.kt）。</summary>
public class KbApiWriteTests
{
    private const string ApiBase = "https://env-test-000000.api.tcloudbasegateway.com";

    private static KbApi Build(StubHttpHandler handler) => new(new HttpClient(handler), ApiBase);

    [Fact]
    public async Task InsertSecretRow_Posts_Payload_And_KeyEpoch()
    {
        var handler = StubHttpHandler.Json(_ => "[]", HttpStatusCode.Created);
        var api = Build(handler);

        await api.InsertSecretRowAsync("KB1:payload", 3);

        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, req.Method);
        Assert.Equal(ApiBase + "/v1/rdb/rest/kb_secrets", req.Uri!.ToString());
        var body = JsonDocument.Parse(req.Body).RootElement;
        Assert.Equal("KB1:payload", body.GetProperty("payload").GetString());
        Assert.Equal(3, body.GetProperty("key_epoch").GetInt32());
        // owner_id 不传（服务端 auth.uid() 自动写入）
        Assert.False(body.TryGetProperty("owner_id", out _));
    }

    [Fact]
    public async Task UpdateSecretRow_Patches_With_UpdatedAt()
    {
        var handler = StubHttpHandler.Json(_ => "[]", HttpStatusCode.NoContent);
        var api = Build(handler);

        await api.UpdateSecretRowAsync(42, "KB1:new", 5);

        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Patch, req.Method);
        Assert.Equal(ApiBase + "/v1/rdb/rest/kb_secrets?id=eq.42", req.Uri!.ToString());
        var body = JsonDocument.Parse(req.Body).RootElement;
        Assert.Equal("KB1:new", body.GetProperty("payload").GetString());
        Assert.Equal(5, body.GetProperty("key_epoch").GetInt32());
        // updated_at = 本机当前时间 ISO（格式 yyyy-MM-ddTHH:mm:ssZ）
        string updatedAt = body.GetProperty("updated_at").GetString()!;
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", updatedAt);
    }

    [Fact]
    public async Task DeleteSecretRow_Deletes_ById()
    {
        var handler = StubHttpHandler.Json(_ => "[]", HttpStatusCode.NoContent);
        var api = Build(handler);

        await api.DeleteSecretRowAsync(7);

        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Delete, req.Method);
        Assert.Equal(ApiBase + "/v1/rdb/rest/kb_secrets?id=eq.7", req.Uri!.ToString());
        Assert.Null(req.Authorization); // 注意：拦截器在真实链路附加；此处裸 client 无头
    }

    [Fact]
    public async Task Write_Conflict_409_Throws_EpochChanged()
    {
        var handler = StubHttpHandler.Json(_ => "{\"message\":\"key_epoch mismatch\"}", HttpStatusCode.Conflict);
        var api = Build(handler);

        var ex = await Assert.ThrowsAsync<AuthApiException>(() => api.UpdateSecretRowAsync(1, "KB1:x", 2));
        Assert.Equal("密钥代数已变化，请先同步", ex.Message);
    }

    [Fact]
    public async Task Write_Http_Error_Throws_AuthException()
    {
        var handler = StubHttpHandler.Json(_ => "{\"message\":\"forbidden\"}", HttpStatusCode.Forbidden);
        var api = Build(handler);

        var ex = await Assert.ThrowsAsync<AuthException>(() => api.DeleteSecretRowAsync(1));
        Assert.Contains("403", ex.Message);
    }
}
