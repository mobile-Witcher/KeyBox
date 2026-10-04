package com.keybox.app.data

import com.keybox.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

/**
 * 手机号验证码登录（三步 REST）+ 会话刷新。
 * HTTP 契约与鸿蒙端 entry/src/main/ets/lib/auth.ets 逐字对齐（Phase 0 真机实测格式）：
 *
 *   ① POST /auth/v1/verification          body {phone_number}                        → verification_id
 *   ② POST /auth/v1/verification/verify   body {verification_id, verification_code}  → verification_token
 *   ③ POST /auth/v1/signin                body {verification_token}                  → Session
 *   ④ POST /auth/v1/token                 body {client_id, client_secret:"", grant_type:"refresh_token", refresh_token}
 *
 * 认证三步（①②③）统一带 Authorization: Bearer <publishable_key> 与 X-SDK-Version 头；
 * 刷新（④）**不得带任何 Authorization 头**——带了会被服务器当 JWT 验签而报 "malformed jwt"。
 */
class AuthRepository(private val client: OkHttpClient) {

    /** 规范化手机号：无国际码则补 "+86 "（与 js-sdk formatPhone / 鸿蒙端行为一致）。 */
    fun normalizePhone(phone: String): String {
        val trimmed = phone.trim()
        return if (PHONE_WITH_COUNTRY_CODE.containsMatchIn(trimmed)) trimmed else "+86 $trimmed"
    }

    /** Step ①：发送验证码 → verification_id。 */
    suspend fun sendVerification(phone: String): String = withContext(Dispatchers.IO) {
        val body = JSONObject().put("phone_number", normalizePhone(phone))
        val text = post("/auth/v1/verification", body.toString(), bearer = BuildConfig.PUBLISHABLE_KEY)
        val id = parseObject(text).optString("verification_id")
        if (id.isEmpty()) throw AuthApiException("发送验证码失败：" + text.take(120))
        id
    }

    /** Step ②：校验验证码 → verification_token。 */
    suspend fun verifyCode(verificationId: String, code: String): String = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("verification_id", verificationId)
            .put("verification_code", code)
        val text = post("/auth/v1/verification/verify", body.toString(), bearer = BuildConfig.PUBLISHABLE_KEY)
        val token = parseObject(text).optString("verification_token")
        if (token.isEmpty()) throw AuthApiException("验证码校验失败（已过期或不正确）：" + text.take(120))
        token
    }

    /** Step ③：verification_token 换登录态。 */
    suspend fun signIn(verificationToken: String): Session = withContext(Dispatchers.IO) {
        val body = JSONObject().put("verification_token", verificationToken)
        val text = post("/auth/v1/signin", body.toString(), bearer = BuildConfig.PUBLISHABLE_KEY)
        parseSession(text)
    }

    /**
     * Step ④：refresh_token 换新登录态（access_token 过期后的静默续期）。
     * 端点 /auth/v1/token **无 Authorization 头**；refresh_token 失效时抛
     * [AuthException](recoverableByRelogin = true)，上层据此回登录页。
     */
    suspend fun refreshSession(refreshToken: String): Session = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("client_id", BuildConfig.ENV_ID)
            .put("client_secret", "")
            .put("grant_type", "refresh_token")
            .put("refresh_token", refreshToken)
        val text = try {
            post("/auth/v1/token", body.toString(), bearer = null)
        } catch (e: AuthException) {
            throw AuthException("刷新会话失败：${e.message}", recoverableByRelogin = true)
        }
        try {
            parseSession(text, fallbackRefreshToken = refreshToken)
        } catch (e: AuthApiException) {
            throw AuthException("会话已过期，请重新登录", recoverableByRelogin = true)
        }
    }

    /** 统一 POST：bearer 为 null 时不带 Authorization 头（刷新端点契约）。 */
    private fun post(path: String, jsonBody: String, bearer: String?): String {
        val builder = Request.Builder()
            .url(apiBase() + path)
            .post(jsonBody.toRequestBody(JSON_MEDIA_TYPE))
            .header("Content-Type", "application/json")
            .header("X-SDK-Version", SDK_VERSION)
        if (bearer != null) {
            builder.header("Authorization", "Bearer $bearer")
        }
        try {
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw AuthException("HTTP ${response.code}：" + text.take(120))
                }
                return text
            }
        } catch (e: IOException) {
            throw AuthException("网络请求失败：${e.message}")
        }
    }

    private fun parseSession(text: String, fallbackRefreshToken: String = ""): Session {
        val obj = parseObject(text)
        val accessToken = obj.optString("access_token")
        if (accessToken.isEmpty()) throw AuthApiException("登录失败：" + text.take(120))
        return Session(
            accessToken = accessToken,
            refreshToken = obj.optString("refresh_token", fallbackRefreshToken)
                .ifEmpty { fallbackRefreshToken },
            expiresIn = obj.optLong("expires_in", DEFAULT_EXPIRES_IN),
            uid = obj.optString("sub"),
        )
    }

    private fun parseObject(text: String): JSONObject = try {
        JSONObject(text)
    } catch (e: Exception) {
        throw AuthApiException("响应不是合法 JSON：" + text.take(120))
    }

    private companion object {
        const val SDK_VERSION = "@cloudbase/js-sdk/3.10.1"
        const val DEFAULT_EXPIRES_IN = 7200L
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        val PHONE_WITH_COUNTRY_CODE = Regex("^\\+\\d{1,3}\\s+\\d+")
    }
}

/** API 网关地址（与鸿蒙端 config.ets 一致）。 */
fun apiBase(): String = "https://" + BuildConfig.ENV_ID + ".api.tcloudbasegateway.com"
