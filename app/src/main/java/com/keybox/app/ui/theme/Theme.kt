package com.keybox.app.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.keybox.app.data.SKIN_DEFAULT_ID
import com.keybox.app.data.THEME_MODE_SYSTEM

/**
 * 外观动作与当前状态（由根组件 [com.keybox.app.ui.KeyBoxRoot] 提供，
 * 顶栏入口与外观面板消费）。用单一 CompositionLocal 携带，避免把外观状态
 * 逐层透传到深层列表页。
 */
@Stable
data class AppearanceActions(
    /** 当前生效的深浅（已把「跟随系统」解析为具体值）。 */
    val isDark: Boolean,
    /** 当前皮肤 id（可能是 "default".."sunset" 或伪皮肤 "dynamic"）。 */
    val skinId: String,
    /** 当前深浅模式（"light"/"dark"/"system"）。 */
    val themeMode: String,
    /** 选择皮肤（含伪皮肤 "dynamic"）。 */
    val onSelectSkin: (String) -> Unit,
    /** 选择深浅模式。 */
    val onSelectThemeMode: (String) -> Unit,
    /** 一键在 light/dark 间切换（写入显式模式）。 */
    val onToggleDark: () -> Unit,
) {
    companion object {
        /** 兜底默认值（未包裹 Provider 时使用，保证预览/降级不崩）。 */
        val Default = AppearanceActions(
            isDark = false,
            skinId = SKIN_DEFAULT_ID,
            themeMode = THEME_MODE_SYSTEM,
            onSelectSkin = {},
            onSelectThemeMode = {},
            onToggleDark = {},
        )
    }
}

/** 外观状态/动作的 CompositionLocal。 */
val LocalAppearance = staticCompositionLocalOf { AppearanceActions.Default }

/**
 * KeyBox 主题：Material 3，由「皮肤 × 深浅」驱动。
 *
 * @param skin 当前皮肤（9 种之一）；[KeyBoxSkin.fromId] 负责未知 id 回落。
 * @param darkTheme 当前是否深色（由「深浅模式 + 系统」解析而来）。
 * @param dynamicColor 是否启用「跟随壁纸」伪皮肤：仅 Android 12+ 生效，
 *   否则回落 [skin] 的固定配色。
 */
@Composable
fun KeyBoxTheme(
    skin: KeyBoxSkin,
    darkTheme: Boolean,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val useDynamic = dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

    val colorScheme: ColorScheme = when {
        useDynamic ->
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)

        darkTheme -> skin.darkScheme
        else -> skin.lightScheme
    }

    val kbColors = if (useDynamic) kbColorsFromScheme(colorScheme) else skin.kbColors(darkTheme)

    // 系统栏（状态栏/导航栏）颜色与图标明暗跟随当前皮肤。
    ApplySystemBars(darkTheme = darkTheme, background = colorScheme.background)

    CompositionLocalProvider(LocalKbColors provides kbColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            content = content,
        )
    }
}

/**
 * 系统栏适配：底色取皮肤背景，图标明暗随深浅。
 *
 * 说明：Android 15（API 35）起 `window.statusBarColor` 在强制 edge-to-edge 下已废弃
 * （系统忽略该值，内容绘制到状态栏后方），但设置它仍保证 API 26–34 一致性、且不报错。
 * 图标可见性通过 `isAppearanceLightStatusBars/NavigationBars` 控制，全平台有效。
 */
@Composable
private fun ApplySystemBars(darkTheme: Boolean, background: Color) {
    val view = LocalView.current
    if (view.isInEditMode) return

    val backgroundArgb = background.toArgb()
    SideEffect {
        val activity = view.context as? Activity ?: return@SideEffect
        val window = activity.window
        @Suppress("DEPRECATION")
        run {
            window.statusBarColor = backgroundArgb
            window.navigationBarColor = backgroundArgb
        }
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !darkTheme
            isAppearanceLightNavigationBars = !darkTheme
        }
    }
}

/** 「跟随壁纸」伪皮肤下，从动态配色推导扩展语义色（success/warning）。 */
private fun kbColorsFromScheme(scheme: ColorScheme): KbColors = KbColors(
    success = scheme.tertiary,
    onSuccess = scheme.onTertiary,
    successContainer = scheme.tertiaryContainer,
    onSuccessContainer = scheme.onTertiaryContainer,
    warning = scheme.secondary,
    onWarning = scheme.onSecondary,
    warningContainer = scheme.secondaryContainer,
    onWarningContainer = scheme.onSecondaryContainer,
)
