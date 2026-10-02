using System.Net;
using System.Text;
using KeyBox.Core.Auth;
using Xunit;

namespace KeyBox.Core.Tests;

/// <summary>
/// 401 拦截器测试：自动附加 Bearer；401 时静默刷新并重试一次；SkipAuth 标记的请求
/// 不附加 Authorization 也不触发刷新（刷新端点契约）。
/// </summary>
public class AuthHttpHandlerTests : IDisposable
{
    private readonly string _dir;

    public AuthHttpHandlerTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "keybox-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); }
        catch (IOException) { }
    }

    [Fact]
    public async Task Adds_Bearer_Header_When_Session_Present()
    {
        var store = new SessionStore(Path.Combine(_dir, "session.json"));
        store.Save(new Session("acc-old", "ref-old", 7200, "uid-1"));
        var dataStub = StubHttpHandler.Json(_ => "{\"ok\":true}");
        var authStub = StubHttpHandler.Json(_ => TestJson.Session("acc-old", "ref-old", 7200, "uid-1"));

        var manager = new SessionManager(new AuthRepository(new HttpClient(authStub), "env-test", "pk-test"), store);
        manager.LoadFromStore();
        var handler = new AuthHttpHandler(manager) { InnerHandler = dataStub };
        var client = new HttpClient(handler);
        _ = await client.GetAsync("https://example.com/data");

        Assert.Equal("Bearer acc-old", dataStub.Requests.Single().Authorization!.ToString());
    }

    [Fact]
    public async Task On_401_Refreshes_And_Retries_Once_With_New_Token()
    {
        var store = new SessionStore(Path.Combine(_dir, "session.json"));
        store.Save(new Session("acc-old", "ref-old", 7200, "uid-1"));

        int dataCalls = 0;
        var dataStub = new StubHttpHandler(req =>
        {
            dataCalls++;
            return Task.FromResult(dataCalls == 1
                ? new HttpResponseMessage(HttpStatusCode.Unauthorized)
                : new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"ok\":true}", Encoding.UTF8, "application/json"),
                });
        });

        var authStub = StubHttpHandler.Json(req =>
            req.RequestUri!.AbsolutePath.EndsWith("/token")
                ? TestJson.Session("acc-new", "ref-new", 7200, "uid-1")
                : TestJson.Session("acc-old", "ref-old", 7200, "uid-1"));

        var manager = new SessionManager(new AuthRepository(new HttpClient(authStub), "env-test", "pk-test"), store);
        manager.LoadFromStore();
        var handler = new AuthHttpHandler(manager) { InnerHandler = dataStub };
        var client = new HttpClient(handler);

        var response = await client.GetAsync("https://example.com/data");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, dataCalls);
        Assert.Equal("acc-new", manager.Current!.AccessToken);
        // 第一次请求带旧 token，重试带新 token
        Assert.Equal("Bearer acc-old", dataStub.Requests[0].Authorization!.ToString());
        Assert.Equal("Bearer acc-new", dataStub.Requests[1].Authorization!.ToString());
    }

    [Fact]
    public async Task SkipAuth_Request_Gets_No_Header_And_No_Refresh_On_401()
    {
        var store = new SessionStore(Path.Combine(_dir, "session.json"));
        store.Save(new Session("acc-old", "ref-old", 7200, "uid-1"));

        int dataCalls = 0;
        var dataStub = new StubHttpHandler(_ =>
        {
            dataCalls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized));
        });
        var authStub = StubHttpHandler.Json(_ => TestJson.Session("acc-new", "ref-new", 7200, "uid-1"));

        var manager = new SessionManager(new AuthRepository(new HttpClient(authStub), "env-test", "pk-test"), store);
        manager.LoadFromStore();
        var handler = new AuthHttpHandler(manager) { InnerHandler = dataStub };
        var client = new HttpClient(handler);

        using var request = new HttpRequestMessage(HttpMethod.Get, "https://example.com/auth/v1/token");
        request.Options.Set(AuthHttpHandler.SkipAuthKey, true);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(1, dataCalls); // 没有重试
        Assert.Null(dataStub.Requests.Single().Authorization);
        Assert.Equal("acc-old", manager.Current!.AccessToken); // 未触发刷新
    }
}
