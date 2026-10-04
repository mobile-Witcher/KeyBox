package com.keybox.app.data

/** 认证/网络异常。 */
open class AuthException(
    message: String,
    /** true：重登可解决（refresh_token 失效等），上层可据此回登录页。 */
    val recoverableByRelogin: Boolean = false,
) : Exception(message)

/** 业务失败（响应可解析但缺关键字段，如验证码错误）。 */
class AuthApiException(message: String) : AuthException(message, recoverableByRelogin = false)
