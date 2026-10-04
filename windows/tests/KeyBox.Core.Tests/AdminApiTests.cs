using System.Net;
using System.Text;
using System.Text.Json;
using KeyBox.Core.Admin;
using KeyBox.Core.Auth;
using KeyBox.Core.Data;
using Xunit;

namespace KeyBox.Core.Tests;

/// <summary>管理后台契约测试：直连 RPC 用户列表 / PATCH 单列 status / 邀请码 / 删除数据（照安卓 AdminRepository）。</summary>
public class AdminApiTests
{
    private const string ApiBase = "https://env-test-000000.api.tcloudbasegateway.com";

    private static AdminService Build(StubHttpHandler handler)
        => new(new KbApi(new HttpClient(handler), ApiBase));

    [Fact]
    public async Task ListUsers_Posts_Rpc_And_Parses_Whitelist_Fields()
    {
        var handler = StubHttpHandler.Json(_ =>
            """[{"uid":"u1","username":"张三","status":"active","created_at":"2026-09-30T10:00:00Z","item_count":3},{"uid":"u2","username":"","status":"disabled","created_at":"2026-09-29T00:00:00Z","item_count":0}]""");
        var service = Build(handler);

        List<AdminUserRow> rows = await service.ListUsersAsync();

        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, req.Method);
        Assert.Equal(ApiBase + "/v1/rdb/rest/rpc/kb_admin_user_list", req.Uri!.ToString());
        Assert.Equal("{}", req.Body);

        Assert.Equal(2, rows.Count);
        Assert.Equal("u1", rows[0].Uid);
        Assert.Equal("张三", rows[0].Username);
        Assert.Equal("active", rows[0].Status);
        Assert.Equal(3, rows[0].ItemCount);
        Assert.Equal("u2", rows[1].Uid);
        Assert.Equal("", rows[1].Username); // 空名由 UI 兜底显示「（未命名）」
    }

    [Fact]
    public async Task ListUsers_Accepts_Gateway_Wrapped_Array()
    {
        var handler = StubHttpHandler.Json(_ => """{"kb_admin_user_list":[{"uid":"u1","username":"A","status":"active","created_at":"x","item_count":1}]}""");
        var service = Build(handler);

        List<AdminUserRow> rows = await service.ListUsersAsync();
        Assert.Single(rows);
        Assert.Equal("u1", rows[0].Uid);
    }

    [Fact]
    public async Task ListUsers_Empty_Array_Ok()
    {
        var service = Build(StubHttpHandler.Json(_ => "[]"));
        Assert.Empty(await service.ListUsersAsync());
    }

    [Fact]
    public async Task SetUserStatus_Patches_Only_Status_Column_With_Uid_Filter()
    {
        var handler = StubHttpHandler.Json(_ => "[]", HttpStatusCode.NoContent);
        var service = Build(handler);

        await service.SetUserStatusAsync("uid-7", "disabled");

        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Patch, req.Method);
        Assert.Equal(ApiBase + "/v1/rdb/rest/kb_users?uid=eq.uid-7", req.Uri!.ToString());
        // 只提交 {status} 单列
        var body = JsonDocument.Parse(req.Body).RootElement;
        Assert.Equal("disabled", body.GetProperty("status").GetString());
        Assert.Single(body.EnumerateObject()); // 只提交 {status} 单列
    }

    [Fact]
    public async Task SetUserStatus_Missing_Uid_Throws()
    {
        var service = Build(StubHttpHandler.Json(_ => "[]"));
        await Assert.ThrowsAsync<AuthApiException>(() => service.SetUserStatusAsync("", "active"));
    }

    [Fact]
    public async Task CreateInvite_Calls_Cloud_Function_And_Parses_Code()
    {
        var handler = StubHttpHandler.Json(_ => """{"ok":true,"data":{"code":"INV-123","createdAt":"2026-10-02T00:00:00Z"}}""");
        var service = Build(handler);

        KbInvite invite = await service.CreateInviteAsync();

        var req = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, req.Method);
        Assert.EndsWith("/v1/functions/kbInviteCreate", req.Uri!.ToString());
        Assert.Equal("{}", req.Body);
        Assert.Equal("INV-123", invite.Code);
        Assert.Equal("2026-10-02T00:00:00Z", invite.CreatedAt);
    }

    [Fact]
    public async Task RevokeInvite_Calls_Cloud_Function_With_Code()
    {
        var handler = StubHttpHandler.Json(_ => """{"ok":true,"data":{"codeId":99}}""");
        var service = Build(handler);

        long codeId = await service.RevokeInviteAsync("INV-123");

        var req = Assert.Single(handler.Requests);
        Assert.EndsWith("/v1/functions/kbInviteRevoke", req.Uri!.ToString());
        Assert.Contains("INV-123", req.Body);
        Assert.Equal(99, codeId);
    }

    [Fact]
    public async Task DeleteUserData_Calls_Cloud_Function_And_Returns_Count()
    {
        var handler = StubHttpHandler.Json(_ => """{"ok":true,"data":{"deletedCount":5}}""");
        var service = Build(handler);

        int count = await service.DeleteUserDataAsync("uid-7");

        var req = Assert.Single(handler.Requests);
        Assert.EndsWith("/v1/functions/kbAdminDeleteUserData", req.Uri!.ToString());
        Assert.Contains("uid-7", req.Body);
        Assert.Equal(5, count);
    }

    [Fact]
    public async Task DeleteUserData_Missing_Uid_Throws()
    {
        var service = Build(StubHttpHandler.Json(_ => "{}"));
        await Assert.ThrowsAsync<AuthApiException>(() => service.DeleteUserDataAsync(""));
    }

    [Fact]
    public async Task Cloud_Error_Propagates_Original_Message()
    {
        // 服务端自检错误（如 CANNOT_DELETE_SELF）原样展示
        var handler = StubHttpHandler.Json(_ => """{"ok":false,"error":"CANNOT_DELETE_SELF"}""");
        var service = Build(handler);

        var ex = await Assert.ThrowsAsync<AuthApiException>(() => service.DeleteUserDataAsync("uid-7"));
        Assert.Contains("CANNOT_DELETE_SELF", ex.Message);
    }
}
