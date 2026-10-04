package com.keybox.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder

/** kb_users 的密钥参数行（解锁校验用）。 */
data class KbUserInfo(
    val kdfSalt: String,
    val kdfVerifier: String,
    val keyEpoch: Int,
    val role: String,
    val status: String,
)

/** kb_secrets 一行（只取渲染所需列）。 */
data class KbSecretRow(
    val id: Long,
    val payload: String,
    val keyEpoch: Int,
    val updatedAt: String,
)

/** kbGetMyRole 返回（本人角色 + 密钥参数 + 恢复码材料状态；recovery_* 仅回本人）。 */
data class KbMyRole(
    val role: String,
    val status: String,
    val kdfSalt: String,
    val kdfVerifier: String,
    val keyEpoch: Int,
    val recoverySalt: String,
    val recoveryBlob: String,
    val recoveryAckAt: String,
)

/** kbRotateMaster 的单条重加密密文行。 */
data class KbRotateItem(val id: Long, val payload: String)

/** R12 管理员用户列表行（kb_admin_user_list 白名单字段，不含任何密文/敏感列）。 */
data class AdminUserRow(
    val uid: String,
    val username: String,
    val status: String,
    val createdAt: String,
    val itemCount: Int,
)

/** R02 一次性邀请码（kbInviteCreate 返回）。 */
data class KbInvite(val code: String, val createdAt: String)

/** 云函数归一化返回体。 */
data class KbFnEnvelope(
    val ok: Boolean,
    val data: JSONObject?,
    /** 仅 kbGetMyRole 在"本账号尚未激活"时附带：true=系统已有用户（去邀请码激活）；false=系统还没有用户（去首次初始化）。 */
    val initialized: Boolean = true,
    val error: String,
)

/**
 * CloudBase 数据访问（RDB REST，PostgREST 风格，纯 HTTP）——照鸿蒙 kbapi.ets 形态。
 *
 * 鉴权：Authorization: Bearer <access_token>（用户态）。
 * 隔离：查询过滤 owner_id=eq.<uid>；服务端 RLS 双保险。
 * 请求打 [AuthRequired] 标记 → [AuthInterceptor] 自动附加/续期 token。
 */
class KbApi(private val client: OkHttpClient) {

    /** 读取本人的 kdf_salt / kdf_verifier / key_epoch（解锁校验用）。 */
    suspend fun fetchMyKeyInfo(uid: String, accessToken: String): KbUserInfo = withContext(Dispatchers.IO) {
        val path = "/v1/rdb/rest/kb_users?select=kdf_salt,kdf_verifier,key_epoch,role,status" +
            "&uid=eq." + urlEncode(uid)
        val rows = JSONArray(get(path, accessToken))
        if (rows.length() == 0) {
            throw AuthApiException("账号不存在或已被停用")
        }
        val row = rows.getJSONObject(0)
        KbUserInfo(
            kdfSalt = row.optString("kdf_salt"),
            kdfVerifier = row.optString("kdf_verifier"),
            keyEpoch = row.optInt("key_epoch", 0),
            role = row.optString("role"),
            status = row.optString("status"),
        )
    }

    /** 拉取本人全部密文（按更新时间降序，最新在前）。 */
    suspend fun fetchSecretRows(uid: String, accessToken: String): List<KbSecretRow> = withContext(Dispatchers.IO) {
        val path = "/v1/rdb/rest/kb_secrets?select=id,payload,key_epoch,updated_at" +
            "&owner_id=eq." + urlEncode(uid) + "&order=updated_at.desc"
        parseSecretRows(get(path, accessToken))
    }

    /**
     * 插入一条密文（照鸿蒙 insertSecretRow）：POST /v1/rdb/rest/kb_secrets，
     * body {payload, key_epoch}；owner_id 由数据库列默认值 auth.uid() 自动写入，不传。
     */
    suspend fun insertSecretRow(payload: String, keyEpoch: Int, accessToken: String): Unit = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("payload", payload)
            .put("key_epoch", keyEpoch)
        send("POST", "/v1/rdb/rest/kb_secrets", body.toString(), accessToken)
        Unit
    }

    /**
     * 更新一条密文（照鸿蒙 updateSecretRow）：PATCH /v1/rdb/rest/kb_secrets?id=eq.{id}，
     * body {payload, key_epoch, updated_at(本机当前时间 ISO)}。
     * 服务端代数校验失败（409）时抛「密钥代数已变化」提示，A4 才做完整同步。
     */
    suspend fun updateSecretRow(
        id: Long,
        payload: String,
        keyEpoch: Int,
        accessToken: String,
    ): Unit = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("payload", payload)
            .put("key_epoch", keyEpoch)
            .put("updated_at", java.time.Instant.now().toString())
        send("PATCH", "/v1/rdb/rest/kb_secrets?id=eq.$id", body.toString(), accessToken)
        Unit
    }

    /** 删除一条密文（照鸿蒙 deleteSecretRow）：DELETE /v1/rdb/rest/kb_secrets?id=eq.{id}，硬删；RLS 保证只能删自己的。 */
    suspend fun deleteSecretRow(id: Long, accessToken: String): Unit = withContext(Dispatchers.IO) {
        send("DELETE", "/v1/rdb/rest/kb_secrets?id=eq.$id", null, accessToken)
        Unit
    }

    // -------------------------------------------------------------------------
    // 云函数调用（CloudBase HTTP API）：POST {API_BASE}/v1/functions/{name}，
    // Authorization: Bearer <access_token>，调用者身份由云函数侧从会话注入读取。
    // 返回体 { ok, data?, error? }，HTTP API 可能在体外再包一层 { result: <体> }，统一解包。
    // 照鸿蒙 kbapi.ets invokeFunction。
    // -------------------------------------------------------------------------

    /** R11/R26：取本人 role/status/密钥参数/恢复码材料状态（kbGetMyRole，身份取自会话）。 */
    suspend fun fetchMyRole(accessToken: String): KbMyRole = withContext(Dispatchers.IO) {
        val env = invokeFunction("kbGetMyRole", "{}", accessToken, READ_TIMEOUT_SEC)
        val data = env.data
        if (!env.ok || data == null) {
            throw AuthApiException("读取账号信息失败：" + env.error.ifEmpty { "未知错误" })
        }
        KbMyRole(
            role = data.optString("role"),
            status = data.optString("status"),
            kdfSalt = data.optString("kdfSalt"),
            kdfVerifier = data.optString("kdfVerifier"),
            keyEpoch = data.optInt("keyEpoch", 0),
            recoverySalt = data.optString("recoverySalt"),
            recoveryBlob = data.optString("recoveryBlob"),
            recoveryAckAt = data.optString("recoveryAckAt"),
        )
    }

    /**
     * R21：整批提交重加密后的全量密文（kbRotateMaster；key_epoch+1 由服务端完成）。
     * 只传密文与盐/校验串，主密钥与主密码绝不进入本请求。返回推进后的 key_epoch。
     * readTimeout 放宽（全量重写，照鸿蒙 60s）。
     */
    suspend fun rotateMasterRemote(
        kdfSalt: String,
        kdfSaltPrev: String,
        kdfVerifier: String,
        recoveryBlob: String,
        items: List<KbRotateItem>,
        accessToken: String,
    ): Int = withContext(Dispatchers.IO) {
        val arr = JSONArray()
        for (item in items) {
            arr.put(JSONObject().put("id", item.id).put("payload", item.payload))
        }
        val body = JSONObject()
            .put("kdfSalt", kdfSalt)
            .put("kdfSaltPrev", kdfSaltPrev)
            .put("kdfVerifier", kdfVerifier)
            .put("items", arr)
        if (recoveryBlob.isNotEmpty()) {
            body.put("recoveryBlob", recoveryBlob)
        }
        val env = invokeFunction("kbRotateMaster", body.toString(), accessToken, ROTATE_TIMEOUT_SEC)
        val data = env.data
        if (!env.ok || data == null) {
            throw AuthApiException(env.error.ifEmpty { "未知错误" })
        }
        val keyEpoch = data.optInt("keyEpoch", 0)
        if (keyEpoch <= 0) throw AuthApiException("服务端未返回有效的密钥代数")
        keyEpoch
    }

    /** R28：确认「已抄下恢复码」（kbAckRecovery，写 recovery_ack_at；幂等）。返回确认时间。 */
    suspend fun ackRecoveryRemote(accessToken: String): String = withContext(Dispatchers.IO) {
        val env = invokeFunction("kbAckRecovery", "{}", accessToken, READ_TIMEOUT_SEC)
        val data = env.data
        if (!env.ok || data == null) {
            throw AuthApiException("确认失败：" + env.error.ifEmpty { "未知错误" })
        }
        data.optString("ackedAt")
    }

    // -------------------------------------------------------------------------
    // 管理员后台（R02 邀请码 / R12 用户列表 / R13 停用启用 / R14 删除数据）。
    // 照鸿蒙 kbapi.ets 与 Web src/lib/admin.ts 同构：
    //   列表走直连 RPC、停用走直连 RDB PATCH、邀请码与删除走云函数（删除是唯一 service_role 路径）。
    // -------------------------------------------------------------------------

    /**
     * R12：管理员读取用户列表（直连 RPC `kb_admin_user_list`；函数体内 is_admin() 自检）。
     * 非管理员调用被服务端拒绝（HTTP 非 2xx）→ 抛出、由调用方原样展示。
     * 仅保留白名单字段（uid / username / status / created_at / item_count），不含任何密文/敏感列。
     */
    suspend fun adminListUsers(accessToken: String): List<AdminUserRow> = withContext(Dispatchers.IO) {
        val text = send("POST", ADMIN_USER_LIST_PATH, "{}", accessToken)
        parseAdminUsers(text)
    }

    /**
     * R13：管理员改某用户 status（active=正常 / disabled=停用）。
     * ⚠️ 只提交 `{ status }` 一个字段（禁止整行对象）；**必须带 `uid=eq.<uid>`**（无过滤＝全表更新）。
     * 「不能停用自己」是 UI 防呆、不是权限（服务端 is_admin() + 管理员 RLS 策略兜底）。
     */
    suspend fun adminSetUserStatus(uid: String, status: String, accessToken: String): Unit =
        withContext(Dispatchers.IO) {
            val body = JSONObject().put("status", status)
            send("PATCH", "/v1/rdb/rest/kb_users?uid=eq." + urlEncode(uid), body.toString(), accessToken)
            Unit
        }

    /** R01/R03 门禁探针结果。 */
    data class ActivationProbe(
        /** 已激活（ok 且 status == "active"）。 */
        val activated: Boolean,
        /** 未激活时：true=系统已有用户（去邀请码激活）；false=系统还没有用户（去首次初始化）。 */
        val initialized: Boolean,
        /** 服务端返回的 kb_users.status。 */
        val status: String,
        /** 失败原因（网络异常或服务端错误码）。 */
        val error: String,
    )

    /**
     * R01/R03 门禁探针：登录后判断本账号是否可用（**不抛异常**）。
     * ⚠️ 判定必须看 status == "active"：被软删/停用的账号在 kb_users 里**仍有行**，
     *    kbGetMyRole 照样能返回 —— 只看 ok 会把这类账号误判为"已激活"（Windows 端真机踩过）。
     */
    suspend fun probeActivation(accessToken: String): ActivationProbe = withContext(Dispatchers.IO) {
        try {
            val env = invokeFunction("kbGetMyRole", "{}", accessToken, READ_TIMEOUT_SEC)
            val status = if (env.ok) env.data?.optString("status").orEmpty() else ""
            ActivationProbe(
                activated = env.ok && status == "active",
                initialized = env.initialized,
                status = status,
                error = env.error,
            )
        } catch (e: Exception) {
            ActivationProbe(activated = false, initialized = true, status = "", error = e.message.orEmpty())
        }
    }

    /** R03：用一次性邀请码完成激活（kbRegister）。只上传盐与校验串，主密码与主密钥绝不出设备。 */
    suspend fun registerRemote(
        code: String,
        kdfSalt: String,
        kdfVerifier: String,
        accessToken: String,
    ): KbFnEnvelope = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("code", code)
            .put("kdfSalt", kdfSalt)
            .put("kdfVerifier", kdfVerifier)
        invokeFunction("kbRegister", body.toString(), accessToken, READ_TIMEOUT_SEC)
    }

    /** R01：首个管理员初始化（kbInitAdmin）。服务端守卫：kb_users 已有任意用户即 ALREADY_INITIALIZED。 */
    suspend fun initAdminRemote(
        kdfSalt: String,
        kdfVerifier: String,
        accessToken: String,
    ): KbFnEnvelope = withContext(Dispatchers.IO) {
        val body = JSONObject().put("kdfSalt", kdfSalt).put("kdfVerifier", kdfVerifier)
        invokeFunction("kbInitAdmin", body.toString(), accessToken, READ_TIMEOUT_SEC)
    }

    /** R02：管理员生成一次性邀请码（kbInviteCreate；展示一次，用一次即失效）。 */
    suspend fun inviteCreateRemote(accessToken: String): KbInvite = withContext(Dispatchers.IO) {
        val env = invokeFunction("kbInviteCreate", "{}", accessToken, READ_TIMEOUT_SEC)
        val data = env.data
        if (!env.ok || data == null) {
            throw AuthApiException(env.error.ifEmpty { "生成邀请码失败" })
        }
        KbInvite(code = data.optString("code"), createdAt = data.optString("createdAt"))
    }

    /** R02：管理员作废邀请码（kbInviteRevoke；仅 unused 可作废）。返回作废的 codeId。 */
    suspend fun inviteRevokeRemote(code: String, accessToken: String): Long = withContext(Dispatchers.IO) {
        val body = JSONObject().put("code", code)
        val env = invokeFunction("kbInviteRevoke", body.toString(), accessToken, READ_TIMEOUT_SEC)
        val data = env.data
        if (!env.ok || data == null) {
            // 服务端错误（含 CANNOT_* 等）原样带出
            throw AuthApiException(env.error.ifEmpty { "作废邀请码失败（可能已被使用）" })
        }
        data.optLong("codeId", 0L)
    }

    /**
     * R14：删除某用户全部密钥数据（kbAdminDeleteUserData，全项目唯一持 service_role 的云函数）。
     * 入参只接受一个 uid；返回体仅 { deletedCount }。
     * 服务端自检错误（如 CANNOT_DELETE_SELF）原样展示。
     */
    suspend fun adminDeleteUserDataRemote(uid: String, accessToken: String): Int = withContext(Dispatchers.IO) {
        val body = JSONObject().put("uid", uid)
        val env = invokeFunction("kbAdminDeleteUserData", body.toString(), accessToken, DELETE_TIMEOUT_SEC)
        val data = env.data
        if (!env.ok || data == null) {
            throw AuthApiException(env.error.ifEmpty { "删除用户数据失败" })
        }
        data.optInt("deletedCount", 0)
    }

    /** 解析 kb_admin_user_list 返回：容错数组直返或网关包装 { kb_admin_user_list: [...] }。 */
    private fun parseAdminUsers(text: String): List<AdminUserRow> {
        val trimmed = text.trim()
        val arr: JSONArray = when {
            trimmed.startsWith("[") -> JSONArray(trimmed)
            trimmed.startsWith("{") -> {
                val obj = JSONObject(trimmed)
                var found: JSONArray? = null
                val keys = obj.keys()
                while (keys.hasNext()) {
                    val value = obj.opt(keys.next())
                    if (value is JSONArray) {
                        found = value
                        break
                    }
                }
                found ?: JSONArray()
            }

            else -> JSONArray()
        }
        val out = ArrayList<AdminUserRow>(arr.length())
        for (i in 0 until arr.length()) {
            val row = arr.optJSONObject(i) ?: continue
            out.add(
                AdminUserRow(
                    uid = row.optString("uid"),
                    username = row.optString("username"),
                    status = row.optString("status"),
                    createdAt = row.optString("created_at"),
                    itemCount = row.optInt("item_count", 0),
                ),
            )
        }
        return out
    }

    /** 调用一个云函数并归一化返回体（照鸿蒙 invokeFunction，含 result 包装解包）。 */
    private fun invokeFunction(
        name: String,
        bodyJson: String,
        accessToken: String,
        timeoutSec: Long,
    ): KbFnEnvelope {
        val request = Request.Builder()
            .url(apiBase() + "/v1/functions/" + name)
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $accessToken")
            .tag(AuthRequired::class.java, AuthRequired)
            .post(bodyJson.toRequestBody(JSON_MEDIA))
            .build()
        // 全量重写类请求放宽 readTimeout（派生 client 共享连接池/线程池，不改动默认 client）
        val callClient =
            if (timeoutSec == READ_TIMEOUT_SEC) client
            else client.newBuilder().readTimeout(timeoutSec, java.util.concurrent.TimeUnit.SECONDS).build()
        try {
            callClient.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw AuthException("HTTP ${response.code}：" + text.take(180))
                }
                return parseEnvelope(text)
            }
        } catch (e: IOException) {
            throw AuthException("云函数请求失败：${e.message}")
        }
    }

    /** 解析云函数返回体，解开至多两层 result 包装（对象或 JSON 字符串均可）。 */
    private fun parseEnvelope(text: String): KbFnEnvelope {
        var node = JSONObject(text)
        for (i in 0 until 2) {
            if (!node.has("result") || node.isNull("result")) break
            val inner = node.opt("result")
            val innerObj: JSONObject = when (inner) {
                is JSONObject -> inner
                is String -> runCatching { JSONObject(inner) }.getOrNull() ?: break
                else -> break
            }
            if (innerObj.has("ok") && !node.has("ok")) {
                node = innerObj
            } else {
                break
            }
        }
        val ok = node.optBoolean("ok", false)
        val data = if (node.has("data") && !node.isNull("data")) node.optJSONObject("data") else null
        return KbFnEnvelope(
            ok = ok,
            data = data,
            error = node.optString("error"),
            initialized = if (node.has("initialized")) node.optBoolean("initialized", true) else true,
        )
    }

    private fun parseSecretRows(text: String): List<KbSecretRow> {
        val rows = JSONArray(text)
        val out = ArrayList<KbSecretRow>(rows.length())
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            out.add(
                KbSecretRow(
                    id = row.optLong("id", 0L),
                    payload = row.optString("payload"),
                    keyEpoch = row.optInt("key_epoch", 0),
                    updatedAt = row.optString("updated_at"),
                ),
            )
        }
        return out
    }

    /** 统一 GET（PostgREST 风格查询）。 */
    private fun get(path: String, accessToken: String): String =
        send("GET", path, null, accessToken)

    /** 统一请求：bearer 为用户 access_token（数据请求，拦截器自动 401 续期重试）。 */
    private fun send(method: String, path: String, jsonBody: String?, accessToken: String): String {
        val builder = Request.Builder()
            .url(apiBase() + path)
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $accessToken")
            .tag(AuthRequired::class.java, AuthRequired)
        when (method) {
            "GET" -> builder.get()
            "DELETE" -> builder.delete()
            "POST" -> builder.post((jsonBody ?: "{}").toRequestBody(JSON_MEDIA))
            "PATCH" -> builder.patch((jsonBody ?: "{}").toRequestBody(JSON_MEDIA))
            else -> throw IllegalArgumentException("不支持的方法：$method")
        }
        try {
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (response.code == HTTP_CONFLICT) {
                    throw AuthApiException("密钥代数已变化，请先同步")
                }
                // 401/403 等：把服务端原样错误带出来，便于定位（如 token 过期、列未授权）
                if (!response.isSuccessful) {
                    throw AuthException("HTTP ${response.code}：" + text.take(180))
                }
                return text
            }
        } catch (e: IOException) {
            throw AuthException("网络请求失败：${e.message}")
        }
    }

    private fun urlEncode(value: String): String = URLEncoder.encode(value, "UTF-8")

    private companion object {
        const val HTTP_CONFLICT = 409
        const val READ_TIMEOUT_SEC = 15L
        const val ROTATE_TIMEOUT_SEC = 60L
        /** 删除用户数据为服务端批量事务，readTimeout 放宽（照鸿蒙 60s）。 */
        const val DELETE_TIMEOUT_SEC = 60L
        /** R12 用户列表直连 RPC 路径（不套云函数）。 */
        const val ADMIN_USER_LIST_PATH = "/v1/rdb/rest/rpc/kb_admin_user_list"
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
