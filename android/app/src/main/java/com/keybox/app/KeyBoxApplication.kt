package com.keybox.app

import android.app.Application
import com.keybox.app.data.ServiceLocator

/** 应用入口：进程级单例在此初始化（A1 规模不引入 DI 框架）。 */
class KeyBoxApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(this)
    }
}
