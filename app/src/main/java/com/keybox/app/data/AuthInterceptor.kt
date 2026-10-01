package com.keybox.app.data

import okhttp3.Interceptor
import okhttp3.Response

/** 请求标记：该请求需要带 Bearer access_token（A2 的 RDB REST 数据请求使用）。 */
object AuthRequired

/**
 * 鉴权拦截器：为标记了 [AuthRequired] 的请求附加 access_token；
 * 收到 401 时用 refresh_token 静默续期一次并重试原请求。
 * 续期单飞（synchronized）：并发 401 只触发一次刷新，其余线程复用新 token。
 */
class AuthInterceptor(
    private val sessionStore: SessionStore,
    private val repositoryProvider: () -> AuthRepository,
) : Interceptor {

    private val refreshLock = Any()

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (request.tag(AuthRequired::class.java) == null) {
            return chain.proceed(request)
        }

        val session = sessionStore.load()
            ?: return chain.proceed(request)

        val authed = request.newBuilder()
            .header("Authorization", "Bearer ${session.accessToken}")
            .build()
        val response = chain.proceed(authed)
        if (response.code != HTTP_UNAUTHORIZED) {
            return response
        }
        response.close()

        val fresh = synchronized(refreshLock) {
            val current = sessionStore.load()
            // 其他线程可能已完成刷新（refresh_token 已变）：直接复用，避免重复刷新
            if (current != null && current.refreshToken != session.refreshToken) {
                current
            } else {
                repositoryProvider().refreshSession(session.refreshToken).also {
                    sessionStore.save(it)
                }
            }
        }
        val retried = request.newBuilder()
            .header("Authorization", "Bearer ${fresh.accessToken}")
            .build()
        return chain.proceed(retried)
    }

    private companion object {
        const val HTTP_UNAUTHORIZED = 401
    }
}
