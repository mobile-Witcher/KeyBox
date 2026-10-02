using System.Net.Http.Headers;
using System.Text.Json;
using KeyBox.Core.Auth;

namespace KeyBox.Core.Data;

/// <summary>
/// CloudBase 数据访问（RDB REST，PostgREST 风格，纯 HTTP）——照安卓 KbApi.kt / 鸿蒙 kbapi.ets 形态。
///
/// 鉴权：由 SessionManager.CreateAuthenticatedClient() 提供的 HttpClient 承载——
/// AuthHttpHandler 自动附加 Bearer access_token，并在 401 时静默刷新重试一次。
/// 本类只负责拼路径、发请求、解析 JSON，不感知 token（与 W1 的 401 拦截器解耦，可直接测试）。
/// </summary>
public sealed class KbApi
{
    private readonly HttpClient _client;
    private readonly string _apiBase;

    /// <summary>请求体序列化：不转义 "+" 等 ASCII 符号（与 Kotlin JSONObject / ETS JSON.stringify 一致）。</summary>
    private static readonly System.Text.Json.JsonSerializerOptions JsonOptions = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public KbApi(HttpClient client, string apiBase)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        if (string.IsNullOrWhiteSpace(apiBase)) throw new ArgumentException("apiBase 不能为空", nameof(apiBase));
        _apiBase = apiBase.TrimEnd('/');
    }

    /// <summary>读取本人的 kdf_salt / kdf_verifier / key_epoch（解锁校验用）。</summary>
    public async Task<KbUserInfo> FetchMyKeyInfoAsync(string uid, CancellationToken ct = default)
    {
        string path = "/v1/rdb/rest/kb_users?select=kdf_salt,kdf_verifier,key_epoch&uid=eq." + Uri.EscapeDataString(uid);
        string text = await GetAsync(path, ct).ConfigureAwait(false);

        using JsonDocument doc = ParseDocument(text);
        List<JsonElement> rows = ReadArray(doc);
        if (rows.Count == 0)
        {
            throw new AuthApiException("账号不存在或已被停用");
        }

        JsonElement row = rows[0];
        return new KbUserInfo(
            KdfSalt: GetString(row, "kdf_salt"),
            KdfVerifier: GetString(row, "kdf_verifier"),
            KeyEpoch: GetInt(row, "key_epoch"));
    }

    /// <summary>拉取本人全部密文（按更新时间降序，最新在前）。</summary>
    public async Task<List<KbSecretRow>> FetchSecretRowsAsync(string uid, CancellationToken ct = default)
    {
        string path = "/v1/rdb/rest/kb_secrets?select=id,payload,key_epoch,updated_at"
            + "&owner_id=eq." + Uri.EscapeDataString(uid)
            + "&order=updated_at.desc";
        string text = await GetAsync(path, ct).ConfigureAwait(false);

        using JsonDocument doc = ParseDocument(text);
        List<JsonElement> rows = ReadArray(doc);
        var outRows = new List<KbSecretRow>(rows.Count);
        foreach (JsonElement row in rows)
        {
            outRows.Add(new KbSecretRow(
                Id: GetLong(row, "id"),
                Payload: GetString(row, "payload"),
                KeyEpoch: GetInt(row, "key_epoch"),
                UpdatedAt: GetString(row, "updated_at")));
        }
        return outRows;
    }

    /// <summary>
    /// 插入一条密文（照安卓 insertSecretRow）：POST /v1/rdb/rest/kb_secrets，
    /// body {payload, key_epoch}；owner_id 由数据库列默认值 auth.uid() 自动写入，不传。
    /// </summary>
    public async Task InsertSecretRowAsync(string payload, int keyEpoch, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new { payload, key_epoch = keyEpoch }, JsonOptions);
        await SendAsync(HttpMethod.Post, "/v1/rdb/rest/kb_secrets", body, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// 更新一条密文（照安卓 updateSecretRow）：PATCH /v1/rdb/rest/kb_secrets?id=eq.{id}，
    /// body {payload, key_epoch, updated_at(本机当前时间 ISO)}。
    /// 服务端代数校验失败（409）抛「密钥代数已变化，请先同步」。
    /// </summary>
    public async Task UpdateSecretRowAsync(long id, string payload, int keyEpoch, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new
        {
            payload,
            key_epoch = keyEpoch,
            updated_at = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"),
        }, JsonOptions);
        await SendAsync(HttpMethod.Patch, $"/v1/rdb/rest/kb_secrets?id=eq.{id}", body, ct).ConfigureAwait(false);
    }

    /// <summary>删除一条密文（照安卓 deleteSecretRow）：DELETE /v1/rdb/rest/kb_secrets?id=eq.{id}，硬删；RLS 保证只能删自己的。</summary>
    public async Task DeleteSecretRowAsync(long id, CancellationToken ct = default)
    {
        await SendAsync(HttpMethod.Delete, $"/v1/rdb/rest/kb_secrets?id=eq.{id}", null, ct).ConfigureAwait(false);
    }

    /// <summary>统一 GET（PostgREST 风格查询；Authorization 由拦截器附加）。</summary>
    private async Task<string> GetAsync(string path, CancellationToken ct)
        => await SendAsync(HttpMethod.Get, path, null, ct).ConfigureAwait(false);

    /// <summary>
    /// 统一请求：Authorization 由 401 拦截器（AuthHttpHandler）附加。
    /// 409（服务端代数校验失败）→ AuthApiException「密钥代数已变化，请先同步」。
    /// </summary>
    private async Task<string> SendAsync(HttpMethod method, string path, string? jsonBody, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, _apiBase + path);
        request.Headers.Accept.ParseAdd("application/json");
        if (jsonBody is not null)
        {
            request.Content = new StringContent(jsonBody, System.Text.Encoding.UTF8, "application/json");
        }

        try
        {
            using HttpResponseMessage response = await _client.SendAsync(request, ct).ConfigureAwait(false);
            string text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if ((int)response.StatusCode == 409)
            {
                throw new AuthApiException("密钥代数已变化，请先同步");
            }
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

    private static List<JsonElement> ReadArray(JsonDocument doc)
    {
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
        {
            throw new AuthApiException("响应不是数组：" + Truncate(doc.RootElement.GetRawText()));
        }
        return doc.RootElement.EnumerateArray().ToList();
    }

    private static string GetString(JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out JsonElement prop) && prop.ValueKind == JsonValueKind.String)
        {
            return prop.GetString() ?? "";
        }
        return "";
    }

    private static int GetInt(JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out JsonElement prop))
        {
            if (prop.ValueKind == JsonValueKind.Number && prop.TryGetInt32(out int v)) return v;
        }
        return 0;
    }

    private static long GetLong(JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out JsonElement prop))
        {
            if (prop.ValueKind == JsonValueKind.Number && prop.TryGetInt64(out long v)) return v;
        }
        return 0;
    }

    private static string Truncate(string text, int max = 120)
    {
        return text.Length <= max ? text : text.Substring(0, max);
    }
}
