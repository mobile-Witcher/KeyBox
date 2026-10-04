using System.Net;
using System.Net.Http.Headers;

namespace KeyBox.Core.Auth;

/// <summary>
/// 401 拦截器：为请求附加 Bearer access_token；遇 401 时通过 SessionManager
/// 静默刷新并重试一次。刷新端点（/auth/v1/token）必须跳过本拦截器——
/// 用 request.Options[AuthHttpHandler.SkipAuthKey] = true 标记，该请求不会附加
/// Authorization 头，也不会触发 401 刷新。
/// </summary>
public sealed class AuthHttpHandler : DelegatingHandler
{
    /// <summary>标记请求跳过认证（刷新端点契约：不得带任何 Authorization 头）。</summary>
    public static readonly HttpRequestOptionsKey<bool> SkipAuthKey = new("KeyBox.SkipAuth");

    private static readonly Lazy<string> _deviceId = new(LoadOrCreateDeviceId);

    /// <summary>本机设备 id（%APPDATA%\KeyBox\device.id，首次生成后持久化）。</summary>
    internal static string DeviceId => _deviceId.Value;

    private static string LoadOrCreateDeviceId()
    {
        try
        {
            string dir = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "KeyBox");
            System.IO.Directory.CreateDirectory(dir);
            string file = System.IO.Path.Combine(dir, "device.id");
            if (System.IO.File.Exists(file))
            {
                string saved = System.IO.File.ReadAllText(file).Trim();
                if (saved.Length > 0) { return saved; }
            }
            string gen = "win-" + Guid.NewGuid().ToString("N");
            System.IO.File.WriteAllText(file, gen);
            return gen;
        }
        catch
        {
            return "win-" + Guid.NewGuid().ToString("N");   // 落盘失败也不能阻塞请求
        }
    }

    private readonly SessionManager _manager;

    public AuthHttpHandler(SessionManager manager)
    {
        _manager = manager ?? throw new ArgumentNullException(nameof(manager));
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        // R95：每台设备一个稳定随机 id。平台用 x-device-id 区分"登录账号数"，
        // 缺失时会把多端登录当作同一设备/会话而互相顶掉。
        request.Headers.TryAddWithoutValidation("x-device-id", DeviceId);

        bool skipAuth = request.Options.TryGetValue(SkipAuthKey, out bool skip) && skip;
        bool hasAuth = request.Headers.Authorization is not null;

        if (!skipAuth && !hasAuth && _manager.Current is { } session && !string.IsNullOrEmpty(session.AccessToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        }

        HttpResponseMessage response = await base.SendAsync(request, cancellationToken).ConfigureAwait(false);

        if (!skipAuth && response.StatusCode == HttpStatusCode.Unauthorized && _manager.Current is not null)
        {
            response.Dispose();

            // R95 加固：平台侧偶发续期竞态（invalid_grant 4026）可能让首次续期失败；
                // 先重试一次，仍失败才判会话失效（recoverableByRelogin），避免把用户误登出。
                Session refreshed;
                try
                {
                    refreshed = await _manager.RefreshAsync(cancellationToken).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    await Task.Delay(600, cancellationToken).ConfigureAwait(false);
                    refreshed = await _manager.RefreshAsync(cancellationToken).ConfigureAwait(false);
                }
            using HttpRequestMessage retry = await CloneRequestAsync(request, cancellationToken).ConfigureAwait(false);
            retry.Headers.Authorization = new AuthenticationHeaderValue("Bearer", refreshed.AccessToken);
            return await base.SendAsync(retry, cancellationToken).ConfigureAwait(false);
        }

        return response;
    }

    /// <summary>深拷贝请求以便重试（body 为一次性流，需先读成字节再重建）。</summary>
    private static async Task<HttpRequestMessage> CloneRequestAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var clone = new HttpRequestMessage(request.Method, request.RequestUri)
        {
            Version = request.Version,
        };

        foreach (var (key, value) in request.Headers)
        {
            clone.Headers.TryAddWithoutValidation(key, value);
        }

        if (request.Content is not null)
        {
            byte[] bytes = await request.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
            clone.Content = new ByteArrayContent(bytes);
            foreach (var (key, value) in request.Content.Headers)
            {
                clone.Content.Headers.TryAddWithoutValidation(key, value);
            }
        }

        foreach (var (key, value) in request.Options)
        {
            clone.Options.TryAdd(key, value);
        }

        return clone;
    }
}
