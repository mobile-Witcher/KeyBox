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
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
