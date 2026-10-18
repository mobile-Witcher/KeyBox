# 鸿蒙端命令行构建（不打开 DevEco Studio）

本机已装 **DevEco Studio**（自带 node / hvigor / ohpm / jbr + 内置 SDK），可以直接用命令行编译，无需启动 IDE。

## 环境变量

```powershell
$env:DEVECO_SDK_HOME = 'C:\Program Files\Huawei\DevEco Studio\sdk'
$env:JAVA_HOME       = 'C:\Program Files\Huawei\DevEco Studio\jbr'
$env:NODE_HOME       = 'C:\Program Files\Huawei\DevEco Studio\tools\node'
$env:PATH = "C:\Program Files\Huawei\DevEco Studio\tools\node;C:\Program Files\Huawei\DevEco Studio\tools\ohpm\bin;$env:PATH"
```

## 编译

```powershell
cd F:\project\keybox\KeyBox\harmony
& "C:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.bat" -p product=default assembleHap --no-daemon
```

产物：

```
entry\build\default\outputs\default\entry-default-signed.hap     ← 可直接安装的签名包
entry\build\default\outputs\default\entry-default-unsigned.hap
```

## 装机（连真机或启动模拟器后）

```powershell
# hdc 在 DevEco 的 tools 里；签名配置见 build-profile.json5 的 signingConfigs.default
& "C:\Program Files\Huawei\DevEco Studio\tools\sdk\default\openharmony\toolchains\hdc.exe" install -r `
  "F:\project\keybox\KeyBox\harmony\entry\build\default\outputs\default\entry-default-signed.hap"
```

## 踩过的坑（ArkTS / ArkUI）

| 现象 | 原因 | 处理 |
|---|---|---|
| `Property 'id' ... not assignable to CustomComponent` | 自定义方法名 `id()` 与 ArkUI 内建属性 `.id()` 冲突 | 改名为 `skinId()` |
| `Property 'Light' does not exist on FontWeight` | ArkUI 没有 `Light` | 用 `FontWeight.Lighter` |
| `arkts-no-untyped-obj-literals` | ArkTS 不允许 `Record<K,V>` 的**字面量初始化** | 改成 `switch` 分支 |
| `Image` 图标全空白（不报错） | 把资源名当**字符串**传入：`Image('app.media.ic_users')`，会被当成网络地址/相对路径 | 必须用资源对象 `Image($r('app.media.ic_users'))` 或 `Image($rawfile('ic_users.png'))`；SVG 可用 `.fillColor()` 跟随皮肤着色 |
| 遮罩/投影几乎不可见（淡紫蒙层） | ArkUI 8 位十六进制颜色是 **`#AARRGGBB`（透明在前）**，不是 CSS 的 `#RRGGBBAA`；`#15140F80` 会被解析成 alpha=0x15（8%） | 写成 `#8015140F`；`shadow({color:'#00000033'})` 同样要写 `#33000000` |
| （Canvas 例外）`ctx.fillStyle='#RRGGBBAA'` | Canvas 2D 的颜色字符串沿用 Web CSS 语义（透明在后），与组件 `backgroundColor` 不同 | Canvas 里继续用 `rgba(r,g,b,a)` 字符串最稳，不要和组件颜色混用同一套字面量 |
| 行内按钮被撑满/换行 | 自定义组件实例上不能直接 `.layoutWeight()`；整宽组件塞进 Row 会挤坏布局 | 并排按钮统一 `Row(){ SkinInlineBtn(...) }.layoutWeight(1)`（每个按钮外层各包一个 Row） |

## 皮肤组件清单（`components/SkinChrome.ets`）

| 组件 / 函数 | 用途 |
|---|---|
| `SkinBar` / `SkinWordmark` / `SkinBackdrop` / `SkinSection` / `SkinCard` | 顶栏信息条 / 页头词标 / 页面底纹 / 分区标题 / 卡片卡框 |
| `SkinButton` | 整宽主按钮（`kind: primary / ghost / danger`，`disabled`、`btnHeight`） |
| `SkinInlineBtn` | 行内按钮（并排、表格、菜单项）；根节点宽 100%，配合外层 `Row().layoutWeight(n)` 等宽；`kind: primary / ghost / accent / warn`，其中 **accent = 删除类强调色实心**（随皮肤变色，字色用 `skinAccentInk` 保证 WCAG-AA） |
| `SkinScrim` | 弹层遮罩层：皮肤压暗 + 逐像素点阵（hud 12px / lab 24px / blueprint 32px 网格 / mono 6px 扫描线 / overprint 16px），不拦触摸 |
| `SkinIcon` / `SkinIconButton` | 线性图标（SVG 资源 + `fillColor` 跟随皮肤）/ 带框图标按钮 |
| `sheetBorderColor` / `panelShadow` / `sheetTransition` / `scrimColor` | 弹层描边 / 投影 / 过渡 / 遮罩色 |
| `skinAccentColor` / `skinCardTag` | 皮肤强调色 / 卡片身份小标 |

所有组件自身订阅 `AppStorage('skin' | 'darkMode' | 'systemDark')`，页面无需传色值。

## 图形资源 / 皮肤自检页

`docs/probes/SkinProbe.ets` 是一页**免登录**的皮肤自检页（图标资源 / 遮罩点阵 / 行内按钮 / 5 套皮肤切换）。
验证 UI 组件时可临时启用（**验证完必须还原**，该页不参与正式路由）：

1. 复制到 `entry/src/main/ets/pages/SkinProbe.ets`；
2. `entry/src/main/resources/base/profile/main_pages.json` 的 `src` 末尾加 `"pages/SkinProbe"`；
3. 把 `entryability/EntryAbility.ets` 的 `windowStage.loadContent('pages/Index', ...)` 临时改成 `'pages/SkinProbe'`；
4. 构建装机 → 点皮肤/明暗按钮、打开条件渲染弹层截图；
5. 还原 ①（删除页面副本）②（main_pages）③（EntryAbility），重新构建。

真机自动化（本机脚本，仓库外）：`hdc snapshot_display -f /data/local/tmp/x.jpeg` + `hdc file recv`；
点击可用 `hdc shell uinput -T -c <x> <y>`（坐标是 1600×2560 物理像素）。

## 主题层说明

`entry/src/main/ets/lib/theme.ets` 是唯一色值来源（5 套皮肤 × 明暗）；
`entry/src/main/ets/components/SkinChrome.ets` 提供 `SkinBar`（顶栏信息条）与 `SkinWordmark`（页头词标），
两者自己订阅 `AppStorage('skin' | 'darkMode' | 'systemDark')`，页面只需放一行。
