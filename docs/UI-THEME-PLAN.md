# Android 原生端 UI 优化 + Web 主题迁移方案

> 状态：待所有者确认。确认后分批实施。
> 背景：Android 原生端功能已全（A1–A7），当前主题为 Material 3 默认 + dynamicColor（系统壁纸取色），
> 与 Web 端的 9 皮肤 × 深浅色体系不一致。本方案将 Web 主题体系迁移到原生端，并做一轮视觉打磨。

## 一、现状对照

| 维度 | Web 端（契约源） | Android 原生端（现状） |
|---|---|---|
| 皮肤数 | **9 种**（default/tech/minimal/paper/cyber/kawaii/hacker/solar/sunset） | 无皮肤概念 |
| 明暗 | 每皮肤独立深浅两套（`data-skin` + `.dark`） | 跟随系统（isSystemInDarkTheme） |
| 取色 | 固定品牌色（`--kb-*` CSS 变量，18 个语义槽位） | dynamicColor（Android 12+ 壁纸取色，非品牌色） |
| 持久化 | localStorage（keybox.skin / keybox.theme） | 无 |
| 外观入口 | ThemeToggle（皮肤网格 + 深浅切换） | 无（仅跟随系统） |

**迁移原则**：Web 的 `--kb-*` 变量体系是唯一权威色值来源；M3 ColorScheme 槽位做语义映射；
皮肤 id 与 Web 完全一致，未来可跨端同步。

## 二、主题迁移方案

### 2.1 新建 `ui/theme/Skins.kt`
- `enum class KeyBoxSkin(val id, val label, val hint)`：9 值，id 与 Web `theme.ts` 的 Skin 一致
- 每个皮肤提供 **light + dark 两套 `ColorScheme`**，色值直接取自 Web `index.css` 对应皮肤块

### 2.2 Web 变量 → M3 槽位映射表（以 default 精致克制为例）

| Web 变量 | 语义 | M3 槽位 | default.light |
|---|---|---|---|
| `--kb-bg` | 页面底色 | background | `#f8fafc` |
| `--kb-surface` | 卡片/面板 | surface | `#ffffff` |
| `--kb-surface-2` | 次级面板 | surfaceVariant | `#e8edfa` |
| `--kb-text` | 主文字 | onSurface | `#0d1424` |
| `--kb-muted` | 次要文字 | onSurfaceVariant | `#566178` |
| `--kb-border` | 细分隔 | outlineVariant | `#d8e0f5` |
| `--kb-border-strong` | 强调边框 | outline | `#b9c6ea` |
| `--kb-primary` | 主色 | primary | `#5b53e8` |
| `--kb-primary-contrast` | 主色上的文字 | onPrimary | `#ffffff` |
| `--kb-danger` | 危险 | error | `#e11d48` |
| `--kb-success` | 成功 | tertiary | `#059669` |
| `--kb-warning` | 警告 | （自定义槽位） | `#b45309` |

深色套同理（Web `.dark` 块的值）。每皮肤需人工校准对比度（AA 级），共 18 套。

### 2.3 持久化与默认
- DataStore：`keybox_skin` / `keybox_theme`（与登录态同库，App 重启保持）
- 默认：`default` 皮肤 + 跟随系统深浅
- `SKIN_BG`（首屏底色表）用于启动窗背景，消除启动白闪

### 2.4 外观选择面板（照 Web ThemeToggle）
- 皮肤网格：每个皮肤一张**色卡预览**（主色块 + 名称 + 一句 hint），选中高亮
- 顶部：深浅切换（一键，同步系统栏图标色）
- 入口：顶栏调色盘图标（保留现有位置）

## 三、UI 优化清单（分批）

### B1 主题系统（前置，其他批依赖）
- Skins.kt + 18 套 ColorScheme + DataStore 持久化 + KeyBoxTheme 改造（dynamicColor 改为皮肤驱动）

### B2 外观面板
- 皮肤选择 UI + 深浅切换 + 色卡预览（照 Web ThemeToggle）

### B3 视觉打磨
- 顶栏：surface 色 + 细分隔线 + 沉浸（edge-to-edge，系统栏图标色随主题）
- 密钥卡片：surfaceContainer + 品牌徽章语义色 + 等宽字体展示密钥（对齐 Web 卡片形态）
- 列表：分区头、空态（图标 + 引导文案）、加载态骨架屏
- 状态胶囊（同步/冲突/复制倒计时）：success/error/warning 语义色

### B4 交互与动效
- 页面/对话框转场动画（Compose AnimatedVisibility / Material 过渡）
- 卡片点击水波纹、按钮按压态（M3 默认）

## 四、风险与权衡（诚实版）

| 权衡 | 说明 |
|---|---|
| **dynamicColor 取舍** | 现在是壁纸取色（Android 12+ 用户可能喜欢「手机壳配色」）。皮肤系统是固定品牌色。**建议**：保留一个「跟随壁纸」作为第 10 个选项（伪皮肤），用户二选一，两全 |
| **工作量** | 主要不在代码，在 **18 套配色的人工校准**（9 皮肤 × 深浅，需保证对比度）。建议以 Web 现有值为基准微调，非重做 |
| **迁移完整性** | Web 的 `--kb-shadow / --kb-radius` 属于样式非颜色，原生端用 M3 的 Shape/阴影体系对应，不逐字照搬 |
| **跨端一致性边界** | 色值对齐到「同语义同色」，形状/间距允许平台差异（安卓遵循 M3，网页遵循原设计） |

## 五、验收标准
- 9 皮肤 × 深浅全部可选、切换即时生效、重启保持
- 外观面板可用；色卡预览与真实渲染一致
- 顶栏/卡片/列表/空态/加载态在深色皮肤下对比度达标
- 向量测试保持 14/14；core-crypto 零改动
