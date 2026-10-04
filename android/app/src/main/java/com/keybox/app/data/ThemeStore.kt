package com.keybox.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

// ────────────────────────────────────────────────────────────────────────────
// 皮肤 / 深浅模式契约常量（与 Web 端 src/lib/theme.ts 完全一致，跨端可同步）
// ────────────────────────────────────────────────────────────────────────────

/** 默认皮肤 id（也是未知 id 的兜底）。 */
const val SKIN_DEFAULT_ID = "default"

/** 「跟随壁纸」伪皮肤 id：仅 Android 12+ 有意义，其余回落 default 皮肤。 */
const val SKIN_DYNAMIC_ID = "dynamic"

/** 深浅模式：浅色。 */
const val THEME_MODE_LIGHT = "light"

/** 深浅模式：深色。 */
const val THEME_MODE_DARK = "dark"

/** 深浅模式：跟随系统（默认）。 */
const val THEME_MODE_SYSTEM = "system"

private val Context.themeDataStore by preferencesDataStore(name = "keybox_theme")

/**
 * 外观持久化（皮肤 id + 深浅模式）。
 *
 * 存储：DataStore（与锁定包裹物 PinLockStore 同一套依赖，无新增依赖），
 * App 重启保持；键与 Web localStorage 语义对齐。
 *   - keybox_skin：String，默认 [SKIN_DEFAULT_ID]
 *   - keybox_theme：String（"light"/"dark"/"system"），默认 [THEME_MODE_SYSTEM]
 *
 * 对外暴露 Flow（供 Compose collectAsState）+ 挂起 setter。
 */
class ThemeStore(context: Context) {

    private val dataStore = context.applicationContext.themeDataStore

    /** 当前皮肤 id（未知值回落 default 由消费方 [com.keybox.app.ui.theme.KeyBoxSkin.fromId] 兜底）。 */
    val skinId: Flow<String> = dataStore.data.map { it[KEY_SKIN] ?: SKIN_DEFAULT_ID }

    /** 当前深浅模式（light/dark/system）。 */
    val themeMode: Flow<String> = dataStore.data.map { it[KEY_THEME] ?: THEME_MODE_SYSTEM }

    /** 选中皮肤并持久化。 */
    suspend fun setSkin(id: String) {
        dataStore.edit { it[KEY_SKIN] = id }
    }

    /** 设置深浅模式并持久化。 */
    suspend fun setThemeMode(mode: String) {
        dataStore.edit { it[KEY_THEME] = mode }
    }

    private companion object {
        val KEY_SKIN = stringPreferencesKey("keybox_skin")
        val KEY_THEME = stringPreferencesKey("keybox_theme")
    }
}

/**
 * 启动窗主题的**同步**读取（消除首屏白闪）。
 *
 * 背景：DataStore 是异步 API，无法在 `Activity.onCreate` 里同步取得值去设置
 * `windowBackground`。此处用一个受控的 `runBlocking` 做**唯一一次**同步读取
 * （仅冷启动一次，读的是本地小文件，成本极低），拿到「皮肤 id + 深浅模式」后
 * 交给 MainActivity 计算启动底色。任何异常（首次安装无文件等）都回落默认值，
 * 绝不阻塞或崩溃。
 */
object BootTheme {

    fun read(context: Context): Pair<String, String> = runBlocking {
        val store = ThemeStore(context.applicationContext)
        val skin = runCatching { store.skinId.first() }.getOrDefault(SKIN_DEFAULT_ID)
        val mode = runCatching { store.themeMode.first() }.getOrDefault(THEME_MODE_SYSTEM)
        skin to mode
    }
}
