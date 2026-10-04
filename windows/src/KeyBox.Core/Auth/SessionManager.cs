namespace KeyBox.Core.Auth;

/// <summary>
/// 会话生命周期管理：内存态 + 持久化 + 静默续期（单飞）+ 退出登录。
/// 也负责为未来的数据请求构造「401 自动刷新重试」的 HttpClient（AuthHttpHandler）。
/// 纯托管逻辑，不依赖 WinUI，可在 xUnit 中直接测试。
/// </summary>
public sealed class SessionManager
{
    private readonly AuthRepository _auth;
    private readonly SessionStore _store;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private volatile Session? _current;

    public SessionManager(AuthRepository auth, SessionStore store)
    {
        _auth = auth ?? throw new ArgumentNullException(nameof(auth));
        _store = store ?? throw new ArgumentNullException(nameof(store));
    }

    /// <summary>当前内存会话（null 表示未登录）。</summary>
    public Session? Current => _current;

    /// <summary>启动时从本地存储恢复会话（重启免验证码）。</summary>
    public Session? LoadFromStore()
    {
        _current = _store.Load();
        return _current;
    }

    /// <summary>Step ①：发送验证码，返回 verification_id。</summary>
    public Task<string> SendVerificationCodeAsync(string phone, CancellationToken ct = default)
        => _auth.SendVerificationAsync(phone, ct);

    /// <summary>完整验证码登录：② 校验验证码 + ③ signin，成功后持久化。</summary>
    public async Task<Session> SignInWithCodeAsync(
        string phone,
        string verificationId,
        string code,
        CancellationToken ct = default)
    {
        string token = await _auth.VerifyCodeAsync(verificationId, code, ct).ConfigureAwait(false);
        Session session = await _auth.SignInAsync(token, ct).ConfigureAwait(false);
        _current = session;
        _store.Save(session);
        return session;
    }

    /// <summary>
    /// 静默续期：用 refresh_token 换新登录态并持久化。
    /// 单飞：并发触发时只发起一次刷新，其余调用复用结果。
    /// refresh_token 失效时抛 AuthException(recoverableByRelogin = true)。
    /// </summary>
    public async Task<Session> RefreshAsync(CancellationToken ct = default)
    {
        Session? before = _current;
        await _refreshLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            // 等待期间其它请求已刷新成功：直接复用其结果
            if (!ReferenceEquals(before, _current) && _current is { } already && !string.IsNullOrEmpty(already.AccessToken))
            {
                return already;
            }

            var cur = _current;
            if (cur is null || string.IsNullOrEmpty(cur.RefreshToken))
            {
                throw new AuthException("会话已过期，请重新登录", recoverableByRelogin: true);
            }

            Session refreshed = await _auth.RefreshSessionAsync(cur.RefreshToken, ct).ConfigureAwait(false);
            _current = refreshed;
            _store.Save(refreshed);
            return refreshed;
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    /// <summary>退出登录：清空内存态并删除本地会话文件。</summary>
    public void SignOut()
    {
        _current = null;
        _store.Delete();
    }

    /// <summary>
    /// 为数据请求构造带认证的 HttpClient：自动附加 Bearer access_token，
    /// 遇 401 时静默刷新并重试一次（刷新端点自身通过 SkipAuth 标记绕过）。
    /// </summary>
    public HttpClient CreateAuthenticatedClient()
    {
        var handler = new AuthHttpHandler(this)
        {
            InnerHandler = new HttpClientHandler(),
        };
        return new HttpClient(handler);
    }
}
