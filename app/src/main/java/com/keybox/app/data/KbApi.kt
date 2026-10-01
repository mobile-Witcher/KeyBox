package com.keybox.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
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
        val rows = JSONArray(get(path, accessToken))
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
        out
    }

    /** 统一 GET（PostgREST 风格查询）。 */
    private fun get(path: String, accessToken: String): String {
        val request = Request.Builder()
            .url(apiBase() + path)
            .get()
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $accessToken")
            .tag(AuthRequired::class.java, AuthRequired)
            .build()
        try {
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
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
}
