namespace KeyBox.Core.Auth;

/// <summary>
/// 登录会话（与 Web/安卓/鸿蒙端 Session 结构一致）。
/// </summary>
public sealed record Session(
    string AccessToken,
    string RefreshToken,
    long ExpiresIn,
    string Uid);

/// <summary>
/// 认证/网络错误。默认不可重登恢复（recoverableByRelogin = false 表示可重试/属普通错误）；
/// recoverableByRelogin = true 表示 refresh_token 失效，必须回登录页重新登录。
/// </summary>
public class AuthException : Exception
{
    public bool RecoverableByRelogin { get; }

    public AuthException(string message, bool recoverableByRelogin = false)
        : base(message)
    {
        RecoverableByRelogin = recoverableByRelogin;
    }
}

/// <summary>API 契约层错误（响应非法 / 字段缺失等），与 Android AuthApiException 对应。</summary>
public sealed class AuthApiException : AuthException
{
    public AuthApiException(string message)
        : base(message)
    {
    }
}
