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

/** 云函数归一化返回体。 */
data class KbFnEnvelope(
    val ok: Boolean,
    val data: JSONObject?,
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
        return KbFnEnvelope(ok = ok, data = data, error = node.optString("error"))
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
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
