using KeyBox.Core.Auth;
using Xunit;

namespace KeyBox.Core.Tests;

public class SessionManagerTests : IDisposable
{
    private readonly string _dir;
    private readonly string _path;

    public SessionManagerTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "keybox-tests-" + Guid.NewGuid().ToString("N"));
        _path = Path.Combine(_dir, "session.json");
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); }
        catch (IOException) { }
    }

    private static (SessionManager Manager, StubHttpHandler Handler) Build(StubHttpHandler handler)
    {
        var repo = new AuthRepository(new HttpClient(handler), "env-test", "pk-test");
        var manager = new SessionManager(repo, new SessionStore(Path.Combine(Path.GetTempPath(), "keybox-tests-unused.json")));
        return (manager, handler);
    }

    [Fact]
    public async Task SignInWithCodeAsync_Persists_Session_To_Store()
    {
        var handler = StubHttpHandler.Json(req =>
            req.RequestUri!.AbsolutePath.EndsWith("/verify") ? "{\"verification_token\":\"vt-1\"}" : TestJson.Session("acc-1", "ref-1", 7200, "uid-7"));
        var store = new SessionStore(_path);
        var manager = new SessionManager(new AuthRepository(new HttpClient(handler), "env-test", "pk-test"), store);

        Session session = await manager.SignInWithCodeAsync("13800138000", "vid-1", "123456");

        Assert.Equal("uid-7", session.Uid);
        Assert.Same(session, manager.Current);
        Assert.Equal("acc-1", store.Load()!.AccessToken);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task RefreshAsync_Refreshes_And_Persists_New_Session()
    {
        int refreshCalls = 0;
        var handler = StubHttpHandler.Json(req =>
        {
            if (req.RequestUri!.AbsolutePath.EndsWith("/token"))
            {
                refreshCalls++;
                return TestJson.Session("acc-new", "ref-new", 7200, "uid-7");
            }
            return TestJson.Session("acc-1", "ref-1", 7200, "uid-7");
        });
        var store = new SessionStore(_path);
        store.Save(new Session("acc-old", "ref-old", 7200, "uid-7"));
        var manager = new SessionManager(new AuthRepository(new HttpClient(handler), "env-test", "pk-test"), store);
        manager.LoadFromStore();

        Session refreshed = await manager.RefreshAsync();

        Assert.Equal("acc-new", refreshed.AccessToken);
        Assert.Equal("acc-new", manager.Current!.AccessToken);
        Assert.Equal("acc-new", store.Load()!.AccessToken);
        Assert.Equal(1, refreshCalls);
    }

    [Fact]
    public async Task RefreshAsync_Concurrent_Calls_Refresh_Only_Once()
    {
        int refreshCalls = 0;
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var handler = StubHttpHandler.Async(async req =>
        {
            if (req.RequestUri!.AbsolutePath.EndsWith("/token"))
            {
                Interlocked.Increment(ref refreshCalls);
                // 异步等待门闩：让两个并发调用都先卡在 SessionManager 的刷新锁上
                await gate.Task.ConfigureAwait(false);
                return TestJson.Ok(TestJson.Session("acc-new", "ref-new", 7200, "uid-7"));
            }
            return TestJson.Ok(TestJson.Session("acc-1", "ref-1", 7200, "uid-7"));
        });

        var store = new SessionStore(_path);
        store.Save(new Session("acc-old", "ref-old", 7200, "uid-7"));
        var manager = new SessionManager(new AuthRepository(new HttpClient(handler), "env-test", "pk-test"), store);
        manager.LoadFromStore();

        Task<Session> t1 = manager.RefreshAsync();
        Task<Session> t2 = manager.RefreshAsync();
        await Task.Delay(100); // 确保两个调用都进入刷新流程
        gate.SetResult();

        Session s1 = await t1;
        Session s2 = await t2;

        Assert.Equal("acc-new", s1.AccessToken);
        Assert.Equal("acc-new", s2.AccessToken);
        Assert.Equal(1, refreshCalls);
    }

    [Fact]
    public async Task RefreshAsync_Without_Session_Throws_Recoverable()
    {
        var handler = StubHttpHandler.Json(_ => TestJson.Session("acc", "ref", 7200, "u1"));
        var manager = new SessionManager(new AuthRepository(new HttpClient(handler), "env-test", "pk-test"), new SessionStore(_path));

        var ex = await Assert.ThrowsAsync<AuthException>(() => manager.RefreshAsync());
        Assert.True(ex.RecoverableByRelogin);
    }

    [Fact]
    public async Task SignOut_Clears_Memory_And_Deletes_Store()
    {
        var handler = StubHttpHandler.Json(req =>
            req.RequestUri!.AbsolutePath.EndsWith("/verify")
                ? "{\"verification_token\":\"vt-1\"}"
                : TestJson.Session("acc-1", "ref-1", 7200, "uid-7"));
        var store = new SessionStore(_path);
        var manager = new SessionManager(new AuthRepository(new HttpClient(handler), "env-test", "pk-test"), store);
        await manager.SignInWithCodeAsync("13800138000", "vid-1", "123456");
        Assert.True(File.Exists(_path));

        manager.SignOut();

        Assert.Null(manager.Current);
        Assert.False(File.Exists(_path));
    }
}
