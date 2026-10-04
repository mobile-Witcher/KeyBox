package com.keybox.app.data

import okhttp3.Interceptor
import okhttp3.Response

/** 给所有出站请求附加 x-device-id（认证请求与云函数请求共用同一客户端）。 */
class DeviceIdInterceptor(private val store: DeviceIdStore) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header("x-device-id", store.get())
            .build()
        return chain.proceed(request)
    }
}