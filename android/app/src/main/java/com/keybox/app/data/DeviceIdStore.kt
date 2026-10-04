package com.keybox.app.data

import android.content.Context

/**
 * 设备 id（R95）：平台用 x-device-id 区分"登录账号数"（官方文档原话）。
 * 缺失时多端登录会被视作同一设备/会话而互相顶掉，表现为"两端不能同时登录"。
 * 首次运行生成随机值并持久化：四端各自独立，同一端重启后仍是同一 id。
 */
class DeviceIdStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun get(): String {
        val saved = prefs.getString(KEY_DEVICE_ID, null)
        if (!saved.isNullOrEmpty()) return saved
        val gen = "android-" + java.util.UUID.randomUUID().toString().replace("-", "").take(20)
        prefs.edit().putString(KEY_DEVICE_ID, gen).apply()
        return gen
    }

    private companion object {
        const val PREFS_NAME = "keybox_device"
        const val KEY_DEVICE_ID = "device_id"
    }
}