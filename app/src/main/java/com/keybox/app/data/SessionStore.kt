package com.keybox.app.data

import android.content.Context

/**
 * 会话持久化：SharedPreferences 存 refresh_token/uid 等，重启后免验证码。
 * A1 规模用 SharedPreferences（DataStore 留待后续批次按需迁移）。
 */
class SessionStore(context: Context) {

    private val prefs =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Synchronized
    fun save(session: Session) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, session.accessToken)
            .putString(KEY_REFRESH_TOKEN, session.refreshToken)
            .putLong(KEY_EXPIRES_IN, session.expiresIn)
            .putString(KEY_UID, session.uid)
            .apply()
    }

    /** 读取持久化会话；无有效 refresh_token 视为未登录。 */
    @Synchronized
    fun load(): Session? {
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null).orEmpty()
        if (refreshToken.isEmpty()) return null
        return Session(
            accessToken = prefs.getString(KEY_ACCESS_TOKEN, null).orEmpty(),
            refreshToken = refreshToken,
            expiresIn = prefs.getLong(KEY_EXPIRES_IN, 7200L),
            uid = prefs.getString(KEY_UID, null).orEmpty(),
        )
    }

    @Synchronized
    fun clear() {
        prefs.edit().clear().apply()
    }

    /** 持久化 key_epoch（非敏感元数据）：生物/PIN 解锁路径恢复代数校验用。 */
    @Synchronized
    fun saveKeyEpoch(epoch: Int) {
        prefs.edit().putInt(KEY_KEY_EPOCH, epoch).apply()
    }

    @Synchronized
    fun loadKeyEpoch(): Int = prefs.getInt(KEY_KEY_EPOCH, 0)

    private companion object {
        const val PREFS_NAME = "keybox_session"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_EXPIRES_IN = "expires_in"
        const val KEY_UID = "uid"
        const val KEY_KEY_EPOCH = "key_epoch"
    }
}
