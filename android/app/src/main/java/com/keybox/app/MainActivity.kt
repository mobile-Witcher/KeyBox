package com.keybox.app

import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.ui.graphics.toArgb
import androidx.fragment.app.FragmentActivity
import com.keybox.app.data.BootTheme
import com.keybox.app.data.THEME_MODE_DARK
import com.keybox.app.data.THEME_MODE_LIGHT
import com.keybox.app.ui.KeyBoxRoot
import com.keybox.app.ui.theme.skinBgColor

// FragmentActivity：androidx.biometric 的 BiometricPrompt 要求宿主为 FragmentActivity
class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // 启动窗底色：同步读回上次外观 → 立即铺皮肤底色，消除冷启动白闪。
        applyBootBackground()
        setContent {
            KeyBoxRoot()
        }
    }

    /**
     * 用持久化的「皮肤 + 深浅」解析出首屏底色并设为窗口背景。
     * 「跟随系统」模式按当前系统 uiMode 解析；读取失败一律回落 default，绝不阻塞/崩溃。
     */
    private fun applyBootBackground() {
        val (skinId, themeMode) = BootTheme.read(this)
        val dark = when (themeMode) {
            THEME_MODE_DARK -> true
            THEME_MODE_LIGHT -> false
            else -> (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                Configuration.UI_MODE_NIGHT_YES
        }
        @Suppress("DEPRECATION")
        window.setBackgroundDrawable(ColorDrawable(skinBgColor(skinId, dark).toArgb()))
    }
}
