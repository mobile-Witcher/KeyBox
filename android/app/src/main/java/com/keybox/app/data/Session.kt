package com.keybox.app.data

/**
 * 登录态（与鸿蒙端 auth.ets 的 Session 契约一致）。
 *
 * @param accessToken  数据请求用 Bearer token（7200s 过期）
 * @param refreshToken 静默续期用
 * @param expiresIn    access_token 有效期（秒）
 * @param uid          平台用户 ID（signin 响应的 sub 字段）
 */
data class Session(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Long,
    val uid: String,
)
