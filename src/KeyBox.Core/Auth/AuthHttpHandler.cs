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

    private readonly SessionManager _manager;

    public AuthHttpHandler(SessionManager manager)
    {
        _manager = manager ?? throw new ArgumentNullException(nameof(manager));
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
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
