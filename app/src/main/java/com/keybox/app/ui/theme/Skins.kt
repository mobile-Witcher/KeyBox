package com.keybox.app.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import kotlin.math.max
import kotlin.math.min

/**
 * Skins.kt —— 外观（**皮肤 × 明暗**）在原生端的单一真相来源。
 *
 * 色值权威源（与 Web 端保持一致，未来可跨端同步）：
 *   - `F:\KeyBox\.skin-colors.json`：9 皮肤 × 深浅的 10 个关键色
 *     （bg / surface / surface-2 / primary / text / muted / border / danger / success / warning）
 *   - `F:\KeyBox\src\index.css`：补充 `--kb-border-strong`（→ outline）与
 *     `--kb-primary-contrast`（→ onPrimary）
 *   - `F:\KeyBox\src\lib\theme.ts`：皮肤 id / 中文名（label）/ hint 文案
 *
 * 映射规则（见 docs/UI-THEME-PLAN.md §2.2）：
 *   bg→background  surface→surface  surface-2→surfaceVariant
 *   text→onSurface  muted→onSurfaceVariant
 *   border→outlineVariant  border-strong→outline
 *   primary→primary  primary-contrast→onPrimary
 *   danger→error  success→tertiary
 *   warning→**自定义语义槽位**（LocalKbColors.warning 系列）
 *     —— 不映射到 tertiaryContainer，否则会与「tertiary=success」语义割裂；
 *        改用自定义槽位后 B3 的状态胶囊可直接取 success/error/warning 三色。
 *
 * 对比度校准：全部按 WCAG AA（正文 4.5:1）在 [meetContrast] 里做**确定性**微调
 * （朝黑/白方向混合直至达标），多数皮肤一次通过、仅个别 muted/容器文字被轻微加深或提亮。
 */

/** 单皮肤的 12 个语义基色（已完成深浅区分）。 */
@Immutable
internal data class SkinPalette(
    val background: Color,
    val surface: Color,
    val surfaceVariant: Color,
    val onSurface: Color,
    val onSurfaceVariant: Color,
    val outline: Color,
    val outlineVariant: Color,
    val primary: Color,
    val onPrimary: Color,
    val error: Color,
    val tertiary: Color,
    val warning: Color,
)

/** 关键色之外的扩展语义槽位（success/warning 系列，供状态胶囊等使用）。 */
@Immutable
data class KbColors(
    val success: Color,
    val onSuccess: Color,
    val successContainer: Color,
    val onSuccessContainer: Color,
    val warning: Color,
    val onWarning: Color,
    val warningContainer: Color,
    val onWarningContainer: Color,
)

/** 扩展语义色的主题默认值（default 皮肤·浅色）。 */
val LocalKbColors = staticCompositionLocalOf {
    KbColors(
        success = Color(0xFF059669),
        onSuccess = Color(0xFFF7F7F7),
        successContainer = Color(0xFFE3F1EA),
        onSuccessContainer = Color(0xFF059669),
        warning = Color(0xFFB45309),
        onWarning = Color(0xFFF7F7F7),
        warningContainer = Color(0xFFF3E8D6),
        onWarningContainer = Color(0xFFB45309),
    )
}

/**
 * 9 种皮肤；id / label / hint 与 Web `theme.ts` 的 SKINS 完全一致（顺序即展示顺序）。
 *
 * `lightScheme` / `darkScheme` 为惰性构造的 M3 ColorScheme（共 18 套），
 * 只在首次访问时推导，之后命中缓存。
 */
enum class KeyBoxSkin(val id: String, val label: String, val hint: String) {
    DEFAULT("default", "精致克制", "白/深蓝底，品牌靛蓝点缀，细边框小圆角"),
    TECH("tech", "现代科技感", "深邃底色 + 发光层次，突出保险箱的科技感"),
    MINIMAL("minimal", "极简商务", "无圆角无阴影，靠留白与字距分层"),
    PAPER("paper", "纸质档案感", "米黄纸底 + 衬线字 + 红色套色，像纸质密钥簿"),
    CYBER("cyber", "赛博朋克", "霓虹品红 + 电光青，暗底发光，最张扬"),
    KAWAII("kawaii", "可爱风", "粉白底 + 超大圆角 + 柔光，圆润讨喜"),
    HACKER("hacker", "极客终端", "荧光绿字黑屏 + 等宽字体，终端味十足"),
    SOLAR("solar", "护眼自然", "低饱和莫兰迪，长时间看最不累眼"),
    SUNSET("sunset", "暖阳", "暖橙渐层，明快温暖有活力");

    /** 浅色 M3 配色（惰性，只构造一次）。 */
    val lightScheme: ColorScheme by lazy(LazyThreadSafetyMode.PUBLICATION) {
        resolvePalette(this, dark = false).toColorScheme()
    }

    /** 深色 M3 配色（惰性，只构造一次）。 */
    val darkScheme: ColorScheme by lazy(LazyThreadSafetyMode.PUBLICATION) {
        resolvePalette(this, dark = true).toColorScheme()
    }

    /** 首屏底色（浅色）——用于启动窗背景，消除白闪（对应 Web SKIN_BG）。 */
    val bgLight: Color by lazy(LazyThreadSafetyMode.PUBLICATION) {
        resolvePalette(this, false).background
    }

    /** 首屏底色（深色）。 */
    val bgDark: Color by lazy(LazyThreadSafetyMode.PUBLICATION) {
        resolvePalette(this, true).background
    }

    /** 扩展语义色（success/warning 系列）。 */
    fun kbColors(dark: Boolean): KbColors = resolvePalette(this, dark).toKbColors()

    companion object {
        /** 未知 id（含 "dynamic" 伪皮肤）一律回落 default。 */
        fun fromId(id: String?): KeyBoxSkin =
            entries.firstOrNull { it.id.equals(id, ignoreCase = true) } ?: DEFAULT
    }
}

/** 皮肤首屏底色（按 id 解析，未知 id / "dynamic" 回落 default）。 */
fun skinBgColor(skinId: String?, dark: Boolean): Color =
    KeyBoxSkin.fromId(skinId).let { if (dark) it.bgDark else it.bgLight }

/** 皮肤语义基色（供外观面板色卡预览等使用）。 */
internal fun KeyBoxSkin.palette(dark: Boolean): SkinPalette = resolvePalette(this, dark)

// ---------------------------------------------------------------------------
// 18 套基色（JSON 关键色 + index.css 的 border-strong / primary-contrast）
// ---------------------------------------------------------------------------

private fun resolvePalette(skin: KeyBoxSkin, dark: Boolean): SkinPalette = when (skin) {
    KeyBoxSkin.DEFAULT -> if (dark) SkinPalette(
        background = hex("#0b1120"), surface = hex("#111a2e"), surfaceVariant = hex("#182442"),
        onSurface = hex("#e6ecff"), onSurfaceVariant = hex("#97a6c9"),
        outline = hex("#334155"), outlineVariant = hex("#1e2b47"),
        primary = hex("#818cf8"), onPrimary = hex("#0b1120"),
        error = hex("#fb7185"), tertiary = hex("#34d399"), warning = hex("#fbbf24"),
    ) else SkinPalette(
        background = hex("#f8fafc"), surface = hex("#ffffff"), surfaceVariant = hex("#eef2f7"),
        onSurface = hex("#0f172a"), onSurfaceVariant = hex("#64748b"),
        outline = hex("#cbd5e1"), outlineVariant = hex("#e2e8f0"),
        primary = hex("#4f46e5"), onPrimary = hex("#ffffff"),
        error = hex("#e11d48"), tertiary = hex("#059669"), warning = hex("#b45309"),
    )

    KeyBoxSkin.TECH -> if (dark) SkinPalette(
        background = hex("#070b16"), surface = hex("#0e1526"), surfaceVariant = hex("#131d33"),
        onSurface = hex("#e6ecff"), onSurfaceVariant = hex("#97a6c9"),
        outline = hex("#2e3f63"), outlineVariant = hex("#1e2b47"),
        primary = hex("#818cf8"), onPrimary = hex("#06101f"),
        error = hex("#fb7185"), tertiary = hex("#34d399"), warning = hex("#fbbf24"),
    ) else SkinPalette(
        background = hex("#eef2fb"), surface = hex("#ffffff"), surfaceVariant = hex("#e8edfa"),
        onSurface = hex("#0d1424"), onSurfaceVariant = hex("#566178"),
        outline = hex("#b9c6ea"), outlineVariant = hex("#d8e0f5"),
        primary = hex("#5b53e8"), onPrimary = hex("#ffffff"),
        error = hex("#e11d48"), tertiary = hex("#059669"), warning = hex("#b45309"),
    )

    KeyBoxSkin.MINIMAL -> if (dark) SkinPalette(
        background = hex("#0a0a0a"), surface = hex("#111111"), surfaceVariant = hex("#171717"),
        onSurface = hex("#f2f2f2"), onSurfaceVariant = hex("#8f8f8f"),
        outline = hex("#3a3a3a"), outlineVariant = hex("#242424"),
        primary = hex("#f2f2f2"), onPrimary = hex("#0a0a0a"),
        error = hex("#f87171"), tertiary = hex("#4ade80"), warning = hex("#fbbf24"),
    ) else SkinPalette(
        background = hex("#ffffff"), surface = hex("#ffffff"), surfaceVariant = hex("#fafafa"),
        onSurface = hex("#111111"), onSurfaceVariant = hex("#8a8a8a"),
        outline = hex("#d4d4d4"), outlineVariant = hex("#ececec"),
        primary = hex("#111111"), onPrimary = hex("#ffffff"),
        error = hex("#b91c1c"), tertiary = hex("#15803d"), warning = hex("#a16207"),
    )

    KeyBoxSkin.PAPER -> if (dark) SkinPalette(
        background = hex("#1c1710"), surface = hex("#241e15"), surfaceVariant = hex("#2b241a"),
        onSurface = hex("#ecd9b8"), onSurfaceVariant = hex("#b09a76"),
        outline = hex("#5a4a33"), outlineVariant = hex("#3d3324"),
        primary = hex("#c9603f"), onPrimary = hex("#1c1710"),
        error = hex("#e0704f"), tertiary = hex("#8aa86a"), warning = hex("#d9a441"),
    ) else SkinPalette(
        background = hex("#f4efe4"), surface = hex("#fbf8f1"), surfaceVariant = hex("#f7f2e8"),
        onSurface = hex("#241f16"), onSurfaceVariant = hex("#7a6f5b"),
        outline = hex("#b9ad95"), outlineVariant = hex("#ddd4c0"),
        primary = hex("#8c2b22"), onPrimary = hex("#f8f3e9"),
        error = hex("#9b2c1f"), tertiary = hex("#4f6b3a"), warning = hex("#8a6a1f"),
    )

    KeyBoxSkin.CYBER -> if (dark) SkinPalette(
        background = hex("#07020f"), surface = hex("#120820"), surfaceVariant = hex("#1a0d2e"),
        onSurface = hex("#f5e9ff"), onSurfaceVariant = hex("#a08ec0"),
        outline = hex("#5b2f8a"), outlineVariant = hex("#3a1f5e"),
        primary = hex("#ff2fb0"), onPrimary = hex("#07020f"),
        error = hex("#ff4d6d"), tertiary = hex("#00e5a0"), warning = hex("#ffd166"),
    ) else SkinPalette(
        background = hex("#f7f0fb"), surface = hex("#ffffff"), surfaceVariant = hex("#f1e6f8"),
        onSurface = hex("#14061f"), onSurfaceVariant = hex("#6b5a7a"),
        outline = hex("#c9a8e0"), outlineVariant = hex("#e3cff0"),
        primary = hex("#d1007a"), onPrimary = hex("#ffffff"),
        error = hex("#e01b24"), tertiary = hex("#00a878"), warning = hex("#b26a00"),
    )

    KeyBoxSkin.KAWAII -> if (dark) SkinPalette(
        background = hex("#2a1a24"), surface = hex("#3a2431"), surfaceVariant = hex("#472c3c"),
        onSurface = hex("#ffe3f0"), onSurfaceVariant = hex("#c9a2b6"),
        outline = hex("#7d4a64"), outlineVariant = hex("#5a3648"),
        primary = hex("#ff9ac9"), onPrimary = hex("#2a1a24"),
        error = hex("#ff90ac"), tertiary = hex("#7fd6ae"), warning = hex("#f0c070"),
    ) else SkinPalette(
        background = hex("#fff5f9"), surface = hex("#ffffff"), surfaceVariant = hex("#ffeaf3"),
        onSurface = hex("#4a2b3a"), onSurfaceVariant = hex("#9a7486"),
        outline = hex("#ffb8d6"), outlineVariant = hex("#ffd6e8"),
        primary = hex("#ff7ab6"), onPrimary = hex("#ffffff"),
        error = hex("#f0567a"), tertiary = hex("#4cc38a"), warning = hex("#e0a13c"),
    )

    KeyBoxSkin.HACKER -> if (dark) SkinPalette(
        background = hex("#000000"), surface = hex("#0a0f0a"), surfaceVariant = hex("#101a10"),
        onSurface = hex("#7bf58a"), onSurfaceVariant = hex("#4fae5d"),
        outline = hex("#2f5c34"), outlineVariant = hex("#1c3a1f"),
        primary = hex("#20ff5f"), onPrimary = hex("#000000"),
        error = hex("#ff5f5f"), tertiary = hex("#20ff5f"), warning = hex("#ffd75f"),
    ) else SkinPalette(
        background = hex("#f2f5f0"), surface = hex("#ffffff"), surfaceVariant = hex("#e8efe6"),
        onSurface = hex("#0f1a10"), onSurfaceVariant = hex("#4d6b50"),
        outline = hex("#a8c4a2"), outlineVariant = hex("#cfe0cb"),
        primary = hex("#12772f"), onPrimary = hex("#ffffff"),
        error = hex("#b3261e"), tertiary = hex("#12772f"), warning = hex("#8a6a1f"),
    )

    KeyBoxSkin.SOLAR -> if (dark) SkinPalette(
        background = hex("#1e2318"), surface = hex("#252c1e"), surfaceVariant = hex("#2d3625"),
        onSurface = hex("#dfe6d5"), onSurfaceVariant = hex("#98a68c"),
        outline = hex("#4d5a3e"), outlineVariant = hex("#38422d"),
        primary = hex("#8fbf7f"), onPrimary = hex("#1e2318"),
        error = hex("#d98b7d"), tertiary = hex("#8fbf7f"), warning = hex("#d4b165"),
    ) else SkinPalette(
        background = hex("#f4f0e6"), surface = hex("#fbf8f1"), surfaceVariant = hex("#ece7d9"),
        onSurface = hex("#3f4a44"), onSurfaceVariant = hex("#7a8577"),
        outline = hex("#c2bca8"), outlineVariant = hex("#dcd6c6"),
        primary = hex("#2f6f5e"), onPrimary = hex("#ffffff"),
        error = hex("#a8473c"), tertiary = hex("#4a7a52"), warning = hex("#8f6f2a"),
    )

    KeyBoxSkin.SUNSET -> if (dark) SkinPalette(
        background = hex("#1d1119"), surface = hex("#271a22"), surfaceVariant = hex("#33222c"),
        onSurface = hex("#f7e4dc"), onSurfaceVariant = hex("#c3a396"),
        outline = hex("#5c3f4a"), outlineVariant = hex("#422c35"),
        primary = hex("#ff8a4c"), onPrimary = hex("#1d1119"),
        error = hex("#ff7a6b"), tertiary = hex("#7fc79a"), warning = hex("#f0bb6a"),
    ) else SkinPalette(
        background = hex("#fff4ec"), surface = hex("#ffffff"), surfaceVariant = hex("#ffead9"),
        onSurface = hex("#3d2517"), onSurfaceVariant = hex("#8a6852"),
        outline = hex("#e8bd9a"), outlineVariant = hex("#f6dcc4"),
        primary = hex("#e2622a"), onPrimary = hex("#ffffff"),
        error = hex("#c0392b"), tertiary = hex("#3f8f5f"), warning = hex("#b07620"),
    )
}

// ---------------------------------------------------------------------------
// 基色 → M3 ColorScheme 推导（含 AA 对比度校准）
// ---------------------------------------------------------------------------

private fun SkinPalette.toColorScheme(): ColorScheme {
    val dark = background.luminance() < 0.5f

    // ── 对比度校准后的文字色 ──
    val fixedOnSurface = meetContrast(onSurface, surface)
    val fixedOnSurfaceVariant = meetContrast(onSurfaceVariant, surface)
    val fixedOnPrimary = meetContrast(onPrimary, primary)
    val onError = onColorFor(error)
    val onTertiary = onColorFor(tertiary)

    // ── 容器色（surface 与强调色混合的浅/深色调）──
    val primaryContainer = lerp(surface, primary, 0.16f)
    val secondaryContainer = lerp(surfaceVariant, primary, 0.14f)
    val tertiaryContainer = lerp(surface, tertiary, 0.16f)
    val errorContainer = lerp(surface, error, 0.16f)

    // ── 次要色（品牌色的去饱和版）──
    val secondary = lerp(primary, fixedOnSurfaceVariant, 0.25f)

    // ── surface 系列（面板分层）──
    val surfaceContainerLow = lerp(background, surfaceVariant, 0.5f)
    val surfaceContainerHigh = lerp(surfaceVariant, fixedOnSurfaceVariant, 0.08f)
    val surfaceContainerHighest = lerp(surfaceVariant, fixedOnSurfaceVariant, 0.14f)

    return if (dark) {
        darkColorScheme(
            primary = primary, onPrimary = fixedOnPrimary,
            primaryContainer = primaryContainer,
            onPrimaryContainer = meetContrast(primary, primaryContainer),
            inversePrimary = primary,
            secondary = secondary, onSecondary = onColorFor(secondary),
            secondaryContainer = secondaryContainer,
            onSecondaryContainer = meetContrast(primary, secondaryContainer),
            tertiary = tertiary, onTertiary = onTertiary,
            tertiaryContainer = tertiaryContainer,
            onTertiaryContainer = meetContrast(tertiary, tertiaryContainer),
            background = background, onBackground = fixedOnSurface,
            surface = surface, onSurface = fixedOnSurface,
            surfaceVariant = surfaceVariant, onSurfaceVariant = fixedOnSurfaceVariant,
            inverseSurface = fixedOnSurface, inverseOnSurface = surface,
            error = error, onError = onError,
            errorContainer = errorContainer,
            onErrorContainer = meetContrast(error, errorContainer),
            outline = outline, outlineVariant = outlineVariant,
            scrim = Color(0xFF000000), surfaceTint = primary,
            surfaceBright = surface, surfaceDim = background,
            surfaceContainer = surfaceVariant, surfaceContainerLow = surfaceContainerLow,
            surfaceContainerHigh = surfaceContainerHigh,
            surfaceContainerHighest = surfaceContainerHighest,
            surfaceContainerLowest = background,
        )
    } else {
        lightColorScheme(
            primary = primary, onPrimary = fixedOnPrimary,
            primaryContainer = primaryContainer,
            onPrimaryContainer = meetContrast(primary, primaryContainer),
            inversePrimary = primary,
            secondary = secondary, onSecondary = onColorFor(secondary),
            secondaryContainer = secondaryContainer,
            onSecondaryContainer = meetContrast(primary, secondaryContainer),
            tertiary = tertiary, onTertiary = onTertiary,
            tertiaryContainer = tertiaryContainer,
            onTertiaryContainer = meetContrast(tertiary, tertiaryContainer),
            background = background, onBackground = fixedOnSurface,
            surface = surface, onSurface = fixedOnSurface,
            surfaceVariant = surfaceVariant, onSurfaceVariant = fixedOnSurfaceVariant,
            inverseSurface = fixedOnSurface, inverseOnSurface = surface,
            error = error, onError = onError,
            errorContainer = errorContainer,
            onErrorContainer = meetContrast(error, errorContainer),
            outline = outline, outlineVariant = outlineVariant,
            scrim = Color(0xFF000000), surfaceTint = primary,
            surfaceBright = surface, surfaceDim = background,
            surfaceContainer = surfaceVariant, surfaceContainerLow = surfaceContainerLow,
            surfaceContainerHigh = surfaceContainerHigh,
            surfaceContainerHighest = surfaceContainerHighest,
            surfaceContainerLowest = background,
        )
    }
}

/** SurfacePalette → 扩展语义槽位。 */
private fun SkinPalette.toKbColors(): KbColors {
    val successContainer = lerp(surface, tertiary, 0.16f)
    val warningContainer = lerp(surface, warning, 0.16f)
    return KbColors(
        success = tertiary,
        onSuccess = onColorFor(tertiary),
        successContainer = successContainer,
        onSuccessContainer = meetContrast(tertiary, successContainer),
        warning = warning,
        onWarning = onColorFor(warning),
        warningContainer = warningContainer,
        onWarningContainer = meetContrast(warning, warningContainer),
    )
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 十六进制字符串（"#rrggbb"）→ Color。 */
private fun hex(v: String): Color = Color(("ff" + v.removePrefix("#")).toLong(16))

/** 在给定底色上挑选高对比的纯黑/纯白前景（用于实心强调色上的文字）。 */
private fun onColorFor(background: Color): Color =
    if (background.luminance() > 0.5f) Color(0xFF0A0A0A) else Color(0xFFFAFAFA)

/** WCAG 相对对比度。 */
private fun contrastRatio(a: Color, b: Color): Float {
    val l1 = max(a.luminance(), b.luminance())
    val l2 = min(a.luminance(), b.luminance())
    return (l1 + 0.05f) / (l2 + 0.05f)
}

/**
 * 确定性对比度校准：若不达标，则把前景色朝「黑或白」方向混合直至达到 [target]
 * （AA 正文 4.5:1）。保证 18 套配色在各自底色上都可读，且改动幅度可预期。
 */
private fun meetContrast(fg: Color, bg: Color, target: Float = 4.5f): Color {
    if (contrastRatio(fg, bg) >= target) return fg
    val toward = if (bg.luminance() > 0.5f) Color(0xFF000000) else Color(0xFFFFFFFF)
    var result = fg
    var step = 1
    while (contrastRatio(result, bg) < target && step <= 24) {
        result = lerp(fg, toward, step / 24f)
        step++
    }
    return result
}
