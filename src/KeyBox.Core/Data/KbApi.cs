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

    /// <summary>
    /// 读取本人的账号状态（kb_users.status）。§6.4 R13 收口：
    /// 数据层（kb_secrets 的 RLS 已要求 is_active_user()）在停用后会立刻拒绝读写密钥，
    /// 客户端据此提前给出「账号已停用」的明确提示，而不是把它显示成「暂无密钥」。
    /// 返回 active / disabled / deleted 等；行不可见时按 deleted 处理。
    /// </summary>
    public async Task<string> FetchMyStatusAsync(string uid, CancellationToken ct = default)
    {
        string path = "/v1/rdb/rest/kb_users?select=status&uid=eq." + Uri.EscapeDataString(uid);
        string text = await GetAsync(path, ct).ConfigureAwait(false);

        using JsonDocument doc = ParseDocument(text);
        List<JsonElement> rows = ReadArray(doc);
        if (rows.Count == 0)
        {
            return "deleted";
        }

        return GetString(rows[0], "status");
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

    // -------------------------------------------------------------------------
    // 云函数调用（CloudBase HTTP API）：POST {API_BASE}/v1/functions/{name}，
    // Authorization: Bearer <access_token>（拦截器附加），
    // 返回体 { ok, data?, error? }；HTTP API 可能在体外再包一层 { result: <体> }，统一解包。
    // 照安卓 KbApi.invokeFunction / 鸿蒙 invokeFunction。
    // -------------------------------------------------------------------------

    /// <summary>R11/R26：取本人 role/status/密钥参数/恢复码材料状态（kbGetMyRole，身份取自会话）。</summary>
    public async Task<KbMyRole> FetchMyRoleAsync(CancellationToken ct = default)
    {
        KbFnEnvelope env = await InvokeFunctionAsync("kbGetMyRole", "{}", ct).ConfigureAwait(false);
        JsonElement data = RequireData(env, "读取账号信息失败：");
        return new KbMyRole(
            Role: GetString(data, "role"),
            Status: GetString(data, "status"),
            KdfSalt: GetString(data, "kdfSalt"),
            KdfVerifier: GetString(data, "kdfVerifier"),
            KeyEpoch: GetInt(data, "keyEpoch"),
            RecoverySalt: GetString(data, "recoverySalt"),
            RecoveryBlob: GetString(data, "recoveryBlob"),
            RecoveryAckAt: GetString(data, "recoveryAckAt"));
    }

    /// <summary>
    /// R01/R03 门禁探针：登录成功后调 kbGetMyRole，判断本账号是否已激活。
    /// 不抛异常（网络/未激活都归一成结果），供登录后路由使用。
    /// 未激活时云函数会带 initialized：false=系统没有任何用户（→首次初始化），true=已有用户（→邀请码激活）。
    /// </summary>
    public async Task<ActivationProbe> ProbeActivationAsync(CancellationToken ct = default)
    {
        try
        {
            string text = await SendAsync(HttpMethod.Post, "/v1/functions/kbGetMyRole", "{}", ct).ConfigureAwait(false);

            using JsonDocument doc = ParseDocument(text);
            JsonElement root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("result", out JsonElement inner))
            {
                root = inner;
            }

            bool ok = root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("ok", out JsonElement okEl)
                && okEl.ValueKind == JsonValueKind.True;

            // 注意：被软删/停用的账号在 kb_users 里**仍有行**，kbGetMyRole 照样能返回，
            // 所以「已激活」必须看 status == active，不能只看 ok。
            string status = "";
            if (root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("data", out JsonElement dataEl)
                && dataEl.ValueKind == JsonValueKind.Object
                && dataEl.TryGetProperty("status", out JsonElement stEl)
                && stEl.ValueKind == JsonValueKind.String)
            {
                status = stEl.GetString() ?? "";
            }

            bool? initialized = null;
            if (root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("initialized", out JsonElement initEl)
                && (initEl.ValueKind == JsonValueKind.True || initEl.ValueKind == JsonValueKind.False))
            {
                initialized = initEl.ValueKind == JsonValueKind.True;
            }

            string error = root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("error", out JsonElement errEl)
                && errEl.ValueKind == JsonValueKind.String
                    ? errEl.GetString() ?? ""
                    : "";

            bool activated = ok && string.Equals(status, "active", StringComparison.OrdinalIgnoreCase);
            return new ActivationProbe(activated, initialized, status, error);
        }
        catch (Exception ex)
        {
            return new ActivationProbe(false, null, "", ex.Message);
        }
    }

    /// <summary>
    /// R03：用一次性邀请码完成激活（kbRegister）。只上传盐与校验串，**主密码与主密钥绝不进入本请求**。
    /// 恢复码材料可选（契约里 recoverySalt/recoveryBlob 为可选）。
    /// </summary>
    public async Task<KbFnEnvelope> RegisterAsync(
        string code, string kdfSalt, string kdfVerifier, string recoverySalt, string recoveryBlob, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["kdfSalt"] = kdfSalt,
            ["kdfVerifier"] = kdfVerifier,
        };
        if (!string.IsNullOrEmpty(recoverySalt))
        {
            body["recoverySalt"] = recoverySalt;
            body["recoveryBlob"] = recoveryBlob;
        }

        return await InvokeFunctionAsync("kbRegister", JsonSerializer.Serialize(body, JsonOptions), ct).ConfigureAwait(false);
    }

    /// <summary>R01：首个管理员初始化（kbInitAdmin）。服务端守卫：kb_users 已有任意用户即 ALREADY_INITIALIZED。</summary>
    public async Task<KbFnEnvelope> InitAdminAsync(
        string kdfSalt, string kdfVerifier, string recoverySalt, string recoveryBlob, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["kdfSalt"] = kdfSalt,
            ["kdfVerifier"] = kdfVerifier,
        };
        if (!string.IsNullOrEmpty(recoverySalt))
        {
            body["recoverySalt"] = recoverySalt;
            body["recoveryBlob"] = recoveryBlob;
        }

        return await InvokeFunctionAsync("kbInitAdmin", JsonSerializer.Serialize(body, JsonOptions), ct).ConfigureAwait(false);
    }

    /// <summary>
    /// R21：整批提交重加密后的全量密文（kbRotateMaster；key_epoch+1 由服务端完成）。
    /// 只传密文与盐/校验串，主密钥与主密码绝不进入本请求。返回推进后的 key_epoch。
    /// </summary>
    public async Task<int> RotateMasterRemoteAsync(
        string kdfSalt,
        string kdfSaltPrev,
        string kdfVerifier,
        string recoveryBlob,
        IReadOnlyList<KbRotateItem> items,
        CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new
        {
            kdfSalt,
            kdfSaltPrev,
            kdfVerifier,
            recoveryBlob,
            items = items.Select(i => new { id = i.Id, payload = i.Payload }).ToList(),
        }, JsonOptions);

        KbFnEnvelope env = await InvokeFunctionAsync("kbRotateMaster", body, ct).ConfigureAwait(false);
        JsonElement data = RequireData(env, "");
        int keyEpoch = GetInt(data, "keyEpoch");
        if (keyEpoch <= 0)
        {
            throw new AuthApiException("服务端未返回有效的密钥代数");
        }
        return keyEpoch;
    }

    /// <summary>R28：确认「已抄下恢复码」（kbAckRecovery，写 recovery_ack_at；幂等）。返回确认时间。</summary>
    public async Task<string> AckRecoveryRemoteAsync(CancellationToken ct = default)
    {
        KbFnEnvelope env = await InvokeFunctionAsync("kbAckRecovery", "{}", ct).ConfigureAwait(false);
        JsonElement data = RequireData(env, "确认失败：");
        return GetString(data, "ackedAt");
    }

    // -------------------------------------------------------------------------
    // 管理后台（R02 邀请码 / R12 用户列表 / R13 停用启用 / R14 删除数据）。
    // 照安卓 AdminRepository / Web admin.ts 同构：
    //   列表走直连 RPC、停用走直连 RDB PATCH、邀请码与删除走云函数（删除是唯一 service_role 路径）。
    // -------------------------------------------------------------------------

    /// <summary>
    /// R12：管理员读取用户列表（直连 RPC `kb_admin_user_list`；函数体内 is_admin() 自检）。
    /// 非管理员调用被服务端拒绝（HTTP 非 2xx）→ 抛出、由调用方原样展示。
    /// 仅保留白名单字段（uid / username / status / created_at / item_count），不含任何密文/敏感列。
    /// </summary>
    public async Task<List<AdminUserRow>> AdminListUsersAsync(CancellationToken ct = default)
    {
        string text = await SendAsync(HttpMethod.Post, "/v1/rdb/rest/rpc/kb_admin_user_list", "{}", ct).ConfigureAwait(false);
        return ParseAdminUsers(text);
    }

    /// <summary>
    /// R13：管理员改某用户 status（active=正常 / disabled=停用）。
    /// ⚠️ 只提交 `{ status }` 一个字段（禁止整行对象）；**必须带 `uid=eq.&lt;uid&gt;`**（无过滤＝全表更新）。
    /// 「不能停用自己」是 UI 防呆、不是权限（服务端 is_admin() + 管理员 RLS 策略兜底）。
    /// </summary>
    public async Task AdminSetUserStatusAsync(string uid, string status, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(uid)) throw new AuthApiException("MISSING_UID");
        var body = JsonSerializer.Serialize(new { status }, JsonOptions);
        await SendAsync(HttpMethod.Patch, "/v1/rdb/rest/kb_users?uid=eq." + Uri.EscapeDataString(uid), body, ct).ConfigureAwait(false);
    }

    /// <summary>R02：管理员生成一次性邀请码（kbInviteCreate；展示一次，用一次即失效）。</summary>
    public async Task<KbInvite> InviteCreateRemoteAsync(CancellationToken ct = default)
    {
        KbFnEnvelope env = await InvokeFunctionAsync("kbInviteCreate", "{}", ct).ConfigureAwait(false);
        JsonElement data = RequireData(env, "生成邀请码失败：");
        return new KbInvite(GetString(data, "code"), GetString(data, "createdAt"));
    }

    /// <summary>R02：管理员作废邀请码（kbInviteRevoke；仅 unused 可作废）。返回作废的 codeId。</summary>
    public async Task<long> InviteRevokeRemoteAsync(string code, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new { code }, JsonOptions);
        KbFnEnvelope env = await InvokeFunctionAsync("kbInviteRevoke", body, ct).ConfigureAwait(false);
        JsonElement data = RequireData(env, "作废邀请码失败（可能已被使用）：");
        return GetLong(data, "codeId");
    }

    /// <summary>
    /// R14：删除某用户全部密钥数据（kbAdminDeleteUserData，全项目唯一持 service_role 的云函数）。
    /// 入参只接受一个 uid；返回体仅 { deletedCount }。
    /// 服务端自检错误（如 CANNOT_DELETE_SELF）原样展示。
    /// </summary>
    public async Task<int> AdminDeleteUserDataRemoteAsync(string uid, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(uid)) throw new AuthApiException("MISSING_UID");
        var body = JsonSerializer.Serialize(new { uid }, JsonOptions);
        KbFnEnvelope env = await InvokeFunctionAsync("kbAdminDeleteUserData", body, ct).ConfigureAwait(false);
        JsonElement data = RequireData(env, "");
        return GetInt(data, "deletedCount");
    }

    /// <summary>解析 kb_admin_user_list 返回：容错数组直返或网关包装 { kb_admin_user_list: [...] }。</summary>
    private static List<AdminUserRow> ParseAdminUsers(string text)
    {
        using JsonDocument doc = ParseDocument(text);
        JsonElement root = doc.RootElement;
        List<JsonElement> rows;
        if (root.ValueKind == JsonValueKind.Array)
        {
            rows = root.EnumerateArray().ToList();
        }
        else if (root.ValueKind == JsonValueKind.Object)
        {
            // 网关可能包成 { kb_admin_user_list: [...] } 或含首个数组字段
            JsonElement? found = null;
            foreach (JsonProperty prop in root.EnumerateObject())
            {
                if (prop.Value.ValueKind == JsonValueKind.Array)
                {
                    found = prop.Value;
                    break;
                }
            }
            rows = found?.EnumerateArray().ToList() ?? new List<JsonElement>();
        }
        else
        {
            rows = new List<JsonElement>();
        }

        var outRows = new List<AdminUserRow>(rows.Count);
        foreach (JsonElement row in rows)
        {
            if (row.ValueKind != JsonValueKind.Object) continue;
            outRows.Add(new AdminUserRow(
                Uid: GetString(row, "uid"),
                Username: GetString(row, "username"),
                Status: GetString(row, "status"),
                CreatedAt: GetString(row, "created_at"),
                ItemCount: GetInt(row, "item_count")));
        }
        return outRows;
    }

    /// <summary>调用云函数并归一化返回体（含 result 包装解包）。</summary>
    private async Task<KbFnEnvelope> InvokeFunctionAsync(string name, string bodyJson, CancellationToken ct)
    {
        string text = await SendAsync(HttpMethod.Post, "/v1/functions/" + name, bodyJson, ct).ConfigureAwait(false);
        return ParseEnvelope(text);
    }

    /// <summary>解析云函数返回体，解开至多两层 result 包装（对象或 JSON 字符串均可）。</summary>
    private static KbFnEnvelope ParseEnvelope(string text)
    {
        JsonDocument? doc = null;
        try
        {
            doc = JsonDocument.Parse(text);
            JsonElement node = doc.RootElement;
            for (int i = 0; i < 2; i++)
            {
                if (node.ValueKind != JsonValueKind.Object || !node.TryGetProperty("result", out JsonElement innerEl))
                {
                    break;
                }
                if (node.TryGetProperty("ok", out _))
                {
                    break;
                }

                JsonElement innerObj;
                if (innerEl.ValueKind == JsonValueKind.Object)
                {
                    innerObj = innerEl;
                }
                else if (innerEl.ValueKind == JsonValueKind.String)
                {
                    string? innerStr = innerEl.GetString();
                    try { innerObj = JsonDocument.Parse(innerStr ?? "").RootElement.Clone(); }
                    catch (JsonException) { break; }
                }
                else
                {
                    break;
                }

                if (innerObj.ValueKind == JsonValueKind.Object && innerObj.TryGetProperty("ok", out _))
                {
                    node = innerObj.Clone();
                }
                else
                {
                    break;
                }
            }

            bool ok = node.ValueKind == JsonValueKind.Object
                && node.TryGetProperty("ok", out JsonElement okEl)
                && okEl.ValueKind == JsonValueKind.True;
            JsonElement? data = node.ValueKind == JsonValueKind.Object
                && node.TryGetProperty("data", out JsonElement dataEl)
                && dataEl.ValueKind != JsonValueKind.Null
                ? dataEl.Clone()
                : null;
            string error = node.ValueKind == JsonValueKind.Object ? GetString(node, "error") : "";
            return new KbFnEnvelope(ok, data, error);
        }
        catch (JsonException)
        {
            throw new AuthApiException("云函数响应不是合法 JSON：" + Truncate(text));
        }
        finally
        {
            doc?.Dispose();
        }
    }

    private static JsonElement RequireData(KbFnEnvelope env, string errorPrefix)
    {
        if (!env.Ok || env.Data is not { } data)
        {
            string detail = string.IsNullOrEmpty(env.Error) ? "未知错误" : env.Error;
            throw new AuthApiException(errorPrefix + detail);
        }
        return data;
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
