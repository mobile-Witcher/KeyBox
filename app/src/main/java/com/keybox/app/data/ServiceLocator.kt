package com.keybox.app.data

import android.content.Context
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * 进程级单例容器（A1 规模不引入 DI 框架，保持依赖最小）。
 */
object ServiceLocator {

    @Volatile
    private var initialized = false

    lateinit var sessionStore: SessionStore
        private set

    lateinit var authRepository: AuthRepository
        private set

    lateinit var kbApi: KbApi
        private set

    lateinit var adminRepository: AdminRepository
        private set

    @Synchronized
    fun init(context: Context) {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
            val store = SessionStore(context.applicationContext)
            // 仓库先占位后赋值，拦截器通过 provider 延迟取用，避免构造顺序环
            var repositoryRef: AuthRepository? = null
            val client = OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .addInterceptor(AuthInterceptor(store) { repositoryRef!! })
                .build()
            val repository = AuthRepository(client)
            repositoryRef = repository
            sessionStore = store
            authRepository = repository
            kbApi = KbApi(client) // 同一 OkHttp：数据请求经拦截器自动 401 续期重试
            adminRepository = AdminRepository(kbApi, store) // A6：管理后台数据访问（复用同一 kbApi）
            initialized = true
        }
    }
}
