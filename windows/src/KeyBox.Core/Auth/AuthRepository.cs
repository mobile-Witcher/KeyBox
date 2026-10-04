using System.Net.Http.Headers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using KeyBox.Core.Config;

namespace KeyBox.Core.Auth;

/// <summary>
/// 手机号验证码登录（三步 REST）+ 会话刷新。
/// HTTP 契约与安卓端 AuthRepository.kt / 鸿蒙端 auth.ets 逐字对齐（Phase 0 真机实测格式）：
///
///   ① POST /auth/v1/verification          body {phone_number}                        → verification_id
///   ② POST /auth/v1/verification/verify   body {verification_id, verification_code}  → verification_token
///   ③ POST /auth/v1/signin                body {verification_token}                  → Session
///   ④ POST /auth/v1/token                 body {client_id, client_secret:"", grant_type:"refresh_token", refresh_token}
///
/// 认证三步（①②③）统一带 Authorization: Bearer &lt;publishable_key&gt; 与 X-SDK-Version 头；
/// 刷新（④）**不得带任何 Authorization 头**——带了会被服务器当 JWT 验签而报 "malformed jwt"。
/// </summary>
public sealed class AuthRepository
{
    private const string SdkVersion = "@cloudbase/js-sdk/3.10.1";
    private const long DefaultExpiresIn = 7200L;
    private static readonly System.Text.RegularExpressions.Regex PhoneWithCountryCodeRegex =
        new(@"^\+\d{1,3}\s+\d+", System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>请求体序列化：不转义 "+" 等 ASCII 符号（与 Kotlin JSONObject / ETS JSON.stringify 一致，+86 原样发送）。</summary>
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly HttpClient _client;
    private readonly string _apiBase;
    private readonly string _envId;
    private readonly string _publishableKey;

    public AuthRepository(HttpClient client, string envId, string publishableKey)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        if (string.IsNullOrWhiteSpace(envId)) throw new ArgumentException("envId 不能为空", nameof(envId));
        if (string.IsNullOrEmpty(publishableKey)) throw new ArgumentException("publishableKey 不能为空", nameof(publishableKey));
        _envId = envId;
        _publishableKey = publishableKey;
        _apiBase = "https://" + envId + ".api.tcloudbasegateway.com";
    }

    /// <summary>从 BuildConfig（环境变量 / 本地 keys.json）构造仓库。</summary>
    public static AuthRepository FromBuildConfig(HttpClient client)
        => new(client, BuildConfig.EnvId, BuildConfig.PublishableKey);

    /// <summary>API 网关基址：https://{envId}.api.tcloudbasegateway.com。</summary>
    public string ApiBase => _apiBase;

    /// <summary>规范化手机号：无国际码则补 "+86 "（与 js-sdk formatPhone / 安卓 / 鸿蒙一致）。</summary>
    public static string NormalizePhone(string phone)
    {
        string trimmed = phone.Trim();
        return PhoneWithCountryCodeRegex.IsMatch(trimmed) ? trimmed : "+86 " + trimmed;
    }

    /// <summary>Step ①：发送验证码 → verification_id。</summary>
    public async Task<string> SendVerificationAsync(string phone, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new { phone_number = NormalizePhone(phone) }, JsonOptions);
        string text = await PostAsync("/auth/v1/verification", body, _publishableKey, ct).ConfigureAwait(false);
        string id = ExtractString(text, "verification_id");
        if (string.IsNullOrEmpty(id))
        {
            throw new AuthException("发送验证码失败：" + Truncate(text));
        }
        return id;
    }

    /// <summary>Step ②：校验验证码 → verification_token。</summary>
    public async Task<string> VerifyCodeAsync(string verificationId, string code, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new { verification_id = verificationId, verification_code = code }, JsonOptions);
        string text = await PostAsync("/auth/v1/verification/verify", body, _publishableKey, ct).ConfigureAwait(false);
        string token = ExtractString(text, "verification_token");
        if (string.IsNullOrEmpty(token))
        {
            throw new AuthException("验证码校验失败（已过期或不正确）：" + Truncate(text));
        }
        return token;
    }

    /// <summary>Step ③：verification_token 换登录态。</summary>
    public async Task<Session> SignInAsync(string verificationToken, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new { verification_token = verificationToken }, JsonOptions);
        string text = await PostAsync("/auth/v1/signin", body, _publishableKey, ct).ConfigureAwait(false);
        return ParseSession(text);
    }

    /// <summary>
    /// Step ④：refresh_token 换新登录态（access_token 过期后的静默续期）。
    /// 端点 /auth/v1/token **无 Authorization 头**；refresh_token 失效时抛
    /// AuthException(recoverableByRelogin = true)，上层据此回登录页。
    /// </summary>
    public async Task<Session> RefreshSessionAsync(string refreshToken, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new
        {
            client_id = _envId,
            client_secret = "",
            grant_type = "refresh_token",
            refresh_token = refreshToken
        }, JsonOptions);

        string text;
        try
        {
            text = await PostAsync("/auth/v1/token", body, bearer: null, ct).ConfigureAwait(false);
        }
        catch (AuthException e)
        {
            throw new AuthException("刷新会话失败：" + e.Message, recoverableByRelogin: true);
        }

        try
        {
            return ParseSession(text, fallbackRefreshToken: refreshToken);
        }
        catch (AuthApiException)
        {
            throw new AuthException("会话已过期，请重新登录", recoverableByRelogin: true);
        }
    }

    /// <summary>
    /// 统一 POST。bearer 为 null 时不带 Authorization 头（刷新端点契约，带任何
    /// Authorization 头都会被服务器当 JWT 验签而报 malformed jwt）。
    /// </summary>
    private async Task<string> PostAsync(string path, string jsonBody, string? bearer, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, _apiBase + path)
        {
            Content = new StringContent(jsonBody, Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("X-SDK-Version", SdkVersion);
        if (bearer != null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        }

        try
        {
            using var response = await _client.SendAsync(request, ct).ConfigureAwait(false);
            string text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                throw new AuthException($"HTTP {(int)response.StatusCode}：" + Truncate(text));
            }
            return text;
        }
        catch (AuthException)
        {
            throw;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            throw new AuthException("网络请求失败：" + ex.Message);
        }
    }

    private static Session ParseSession(string text, string fallbackRefreshToken = "")
    {
        using JsonDocument doc = ParseDocument(text);
        var root = doc.RootElement;
        string accessToken = GetString(root, "access_token");
        if (string.IsNullOrEmpty(accessToken))
        {
            throw new AuthApiException("登录失败：" + Truncate(text));
        }

        string refreshToken = GetString(root, "refresh_token");
        if (string.IsNullOrEmpty(refreshToken))
        {
            refreshToken = fallbackRefreshToken;
        }

        long expiresIn = GetLong(root, "expires_in") ?? DefaultExpiresIn;
        string uid = GetString(root, "sub");
        return new Session(accessToken, refreshToken, expiresIn, uid);
    }

    private static string ExtractString(string text, string field)
    {
        using JsonDocument doc = ParseDocument(text);
        return GetString(doc.RootElement, field);
    }

    private static JsonDocument ParseDocument(string text)
    {
        try
        {
            return JsonDocument.Parse(text);
        }
        catch (JsonException)
        {
            throw new AuthApiException("响应不是合法 JSON：" + Truncate(text));
        }
    }

    private static string GetString(JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String)
        {
            return prop.GetString() ?? "";
        }
        return "";
    }

    private static long? GetLong(JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out var prop))
        {
            if (prop.ValueKind == JsonValueKind.Number && prop.TryGetInt64(out long v))
            {
                return v;
            }
        }
        return null;
    }

    private static string Truncate(string text, int max = 120)
    {
        return text.Length <= max ? text : text.Substring(0, max);
    }
}
