package com.keybox.app.ui

import android.os.Build
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.keybox.app.data.SKIN_DYNAMIC_ID
import com.keybox.app.data.THEME_MODE_DARK
import com.keybox.app.data.THEME_MODE_LIGHT
import com.keybox.app.data.THEME_MODE_SYSTEM
import com.keybox.app.ui.theme.KeyBoxSkin
import com.keybox.app.ui.theme.LocalAppearance
import com.keybox.app.ui.theme.palette

/**
 * 外观选择面板（照 Web `src/components/ThemeToggle.tsx` 的交互形态）：
 *   - 顶部：深浅三态切换（浅色 / 深色 / 跟随系统）
 *   - 中部：皮肤网格，每张色卡 = 底色块 + 主色点 + 中文名 + hint；选中高亮描边
 *   - 第 10 张「跟随壁纸」伪皮肤（仅 Android 12+ 展示）
 *
 * 选中即生效并持久化（通过 [LocalAppearance] 的动作回写 ThemeStore）。
 * 溢出保护：所有文本 maxLines + Ellipsis，网格自适应两列。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppearancePanel(onClose: () -> Unit) {
    val appearance = LocalAppearance.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("外观") },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Filled.Close, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // ── 深浅三态切换（整行）──
            item(span = { GridItemSpan(maxLineSpan) }) {
                ThemeModeSection(
                    current = appearance.themeMode,
                    onSelect = appearance.onSelectThemeMode,
                )
            }

            // ── 皮肤网格标题（整行）──
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text(
                    text = "皮肤",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            // ── 9 张皮肤色卡 ──
            items(KeyBoxSkin.entries, key = { it.id }) { skin ->
                val preview = skin.palette(appearance.isDark)
                SkinCard(
                    label = skin.label,
                    hint = skin.hint,
                    selected = appearance.skinId == skin.id,
                    preview = SkinPreview(
                        bg = preview.background,
                        surface = preview.surface,
                        primary = preview.primary,
                        outline = preview.outlineVariant,
                    ),
                    onClick = { appearance.onSelectSkin(skin.id) },
                )
            }

            // ── 第 10 张：跟随壁纸（仅 Android 12+ 有意义）──
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                item {
                    DynamicSkinCard(
                        selected = appearance.skinId == SKIN_DYNAMIC_ID,
                        onClick = { appearance.onSelectSkin(SKIN_DYNAMIC_ID) },
                    )
                }
            }
        }
    }
}

/** 外观面板全屏承载的包裹（带背景，与 SecurityPanelOverlay 同模式）。 */
@Composable
fun AppearancePanelOverlay(onClose: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize()) {
        AppearancePanel(onClose = onClose)
    }
}

// ---------------------------------------------------------------------------
// 深浅三态
// ---------------------------------------------------------------------------

@Composable
private fun ThemeModeSection(current: String, onSelect: (String) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = "深浅模式",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ModeChip("浅色", current == THEME_MODE_LIGHT) { onSelect(THEME_MODE_LIGHT) }
            ModeChip("深色", current == THEME_MODE_DARK) { onSelect(THEME_MODE_DARK) }
            ModeChip("跟随系统", current == THEME_MODE_SYSTEM) { onSelect(THEME_MODE_SYSTEM) }
        }
    }
}

@Composable
private fun ModeChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = {
            Text(
                text = label,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
    )
}

// ---------------------------------------------------------------------------
// 皮肤色卡
// ---------------------------------------------------------------------------

private data class SkinPreview(
    val bg: Color,
    val surface: Color,
    val primary: Color,
    val outline: Color,
)

@Composable
private fun SkinCard(
    label: String,
    hint: String,
    selected: Boolean,
    preview: SkinPreview,
    onClick: () -> Unit,
) {
    val borderColor = if (selected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.outlineVariant
    }
    val borderWidth = if (selected) 2.dp else 1.dp

    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(borderWidth, borderColor),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Swatch(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(preview.bg)
                    .border(1.dp, preview.outline, RoundedCornerShape(8.dp)),
                surface = preview.surface,
                primary = preview.primary,
                outline = preview.outline,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.titleSmall.copy(
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                ),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = hint,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** 色卡内的迷你预览：左上主色点 + 底部一张带描边的「卡片条」。 */
@Composable
private fun Swatch(
    modifier: Modifier,
    surface: Color,
    primary: Color,
    outline: Color,
) {
    Box(modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(8.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Box(
                modifier = Modifier
                    .size(16.dp)
                    .clip(CircleShape)
                    .background(primary),
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth(0.7f)
                    .height(10.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(surface)
                    .border(1.dp, outline, RoundedCornerShape(4.dp)),
            )
        }
    }
}

/** 第 10 张伪皮肤：跟随壁纸（Android 12+ 动态取色）。 */
@Composable
private fun DynamicSkinCard(selected: Boolean, onClick: () -> Unit) {
    val borderColor = if (selected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.outlineVariant
    }
    val borderWidth = if (selected) 2.dp else 1.dp

    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(borderWidth, borderColor),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(
                                Color(0xFF5B8DEF),
                                Color(0xFF9B6BFF),
                                Color(0xFFFF7AB6),
                                Color(0xFF34D399),
                            ),
                        ),
                    ),
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "跟随壁纸",
                style = MaterialTheme.typography.titleSmall.copy(
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                ),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = "提取系统壁纸配色，随壁纸主题变化（Android 12+）",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
