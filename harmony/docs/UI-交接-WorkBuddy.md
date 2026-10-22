# KeyBox 鸿蒙端 UI 皮肤化 · 交接文档（给 WorkBuddy）

> 交接时间：2026-10-22。基线提交 `6a498f1`（此后的改动以 `git log` 为准）。
> 交接范围：**鸿蒙端（harmony/）的 UI / 皮肤化**。业务逻辑（登录、加密、同步、管理）不在本次范围。
> 本文档自包含：环境、设计系统、已完成项、待办项、硬约束、验证流程、验收清单。

---

## 0. 一句话

鸿蒙端已有完整的 5 套皮肤设计系统（令牌 / 壳层 / 卡框 / 遮罩点阵 / 行内按钮 / SVG 图标），
所有页面已完成皮肤化接入；剩余工作是**收尾与打磨**（见 §4），不是从零搭。

---

## 1. 项目与环境

| 项 | 值 |
|---|---|
| 仓库根 | `F:\project\keybox\KeyBox`（monorepo，含 web / windows / android / harmony） |
| 鸿蒙工程 | `F:\project\keybox\KeyBox\harmony` |
| 开发板 | DevEco Studio（无需打开 IDE，可命令行构建） |
| 真机 | 序列号 `6MFBB25C19206043`（HarmonyOS，API 26） |
| 构建 | `hvigorw -p product=default assembleHap --no-daemon`（详见 `harmony/docs/build-cli.md`） |
| 装机 | `hdc install -r entry\build\default\outputs\default\entry-default-signed.hap` |
| 截图 | `hdc shell snapshot_display -f /data/local/tmp/x.jpeg` + `hdc file recv` |
| 本机辅助脚本 | `G:\dsh\kb-dev\dev.ps1`（build / deploy / shot / tap / all，内部有跨进程串行锁；**不在仓库内**） |

`dev.ps1` 用法（Windows PowerShell 5.1，需用 powershell.exe 调用）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\dsh\kb-dev\dev.ps1 -Action all -Name test1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\dsh\kb-dev\dev.ps1 -Action build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\dsh\kb-dev\dev.ps1 -Action tap -X 800 -Y 1200
```

注意：安装/重启后 App 会停在**解锁页**（需要主密码/PIN/指纹之一）；解锁动作只能人工操作手机，
或让 `池` 配合一次。截图坐标是 1600×2560 物理像素。

---

## 2. 设计系统速览

### 2.1 唯一色值来源

`entry/src/main/ets/lib/theme.ets`
- 5 套皮肤：`hud`（工业终端）/ `lab`（实验档案）/ `blueprint`（蓝图海报）/ `mono`（黑白档案）/ `overprint`（套印图录）
- 每套有明/暗两套 `ThemeColors`：`bg/surface/surface2/text/muted/border/borderStrong/primary/primaryHover/primaryContrast/danger/success/warning/radius/radiusCard/fontSans/headingTracking`
- 全局状态走 `AppStorage`：`skin`、`darkMode`（system/light/dark）、`systemDark`
- **页面/组件不硬编码色值**，一律 `colorsOf(normalizeSkinId(this.skin), resolveDark(...))`

### 2.2 组件清单（`components/SkinChrome.ets`）

| 组件 / 函数 | 用途 |
|---|---|
| `SkinBar` | 顶栏信息条（每套皮肤不同文案/反白方式/品牌块形状） |
| `SkinWordmark` | 页头词标 + 皮肤专属图形标记 |
| `SkinBackdrop` | 页面底纹（Canvas 逐像素：hud 8px 网格 / lab 24px 点阵 / blueprint 32px 网格 / mono 3px 扫描线 / overprint 6px 网点）+ 皮肤装饰 |
| `SkinSection` | 分区标题（竖条 + 标题 + 右侧附加信息 + 细分隔线） |
| `SkinCard` | 卡片四角括号 / overprint 圆环 / mono 角块 |
| `SkinButton` | 整宽主按钮：`kind: primary / ghost / danger / accent` |
| `SkinInlineBtn` | 行内按钮：根节点宽 100%，外层 `Row(){...}.layoutWeight(n)` 等宽；`kind: primary / ghost / danger / accent / warn` |
| `SkinScrim` | 弹层遮罩：皮肤压暗 + 逐像素点阵，不拦截触摸 |
| `SkinIcon` / `SkinIconButton` | SVG 图标（`$r` 资源 + `fillColor` 跟随皮肤）/ 30×30 带框图标按钮 |
| `sheetBorderColor` / `panelShadow` / `sheetTransition` / `scrimColor` | 弹层描边 / 投影 / 过渡 / 遮罩色 |
| `skinAccentColor` / `skinAccentInk` / `skinCardTag` | 皮肤强调色 / 强调色上的字色 / 卡片小标 |

### 2.3 按钮语义

- `primary`：主操作（保存 / 确认 / 解锁 / 生成邀请码），皮肤主色实心。
- `ghost`：次要 / 取消 / 编辑，描边 + 中性底。
- `accent`：**删除类按钮**，强调色实心，随皮肤变色（hud 信号黄 / lab 莱茵青 / blueprint 蓝图青 / mono 朱红 / overprint 钴蓝），字色用 `skinAccentInk`（已按 WCAG-AA ≥4.5:1 校过）。
- `warn`：警示色实心（恢复码确认等）。
- 旧 `danger`（固定红）保留在组件里，但**页面已不用**；新增删除类按钮请用 `accent`。

### 2.4 遮罩点阵

`SkinScrim` 纹理：hud 12px 点阵（白 5.5%，对齐 Web）/ lab 24px 点阵（青）/ blueprint 32px 网格（青）/ mono 6px 扫描线 / overprint 16px 点阵（钴蓝）。
用法：弹层最外层 `Stack() { SkinScrim(); Column(){ 面板 } }`；Vault 用全局一层 `if (this.overlayOpen()) { SkinScrim() }`，各弹层自身不再叠 rgba 黑底。

---

## 3. 已完成（不要重复做）

截至基线提交：

1. 5 套皮肤令牌 + 明暗模式 + 旧皮肤 id 迁移（`theme.ets`）。
2. 壳层：`SkinBar` 信息条、`SkinWordmark` 词标、`SkinSection` 分区标题、`SkinCard` 卡框、`SkinBackdrop` 底纹。
3. 弹层：遮罩点阵 `SkinScrim`、描边/投影/过渡、压暗；Vault / Admin / Unlock / SecurityPanel 全部接入。
4. 按钮：全部原生 `Button` 已替换为 `SkinButton` / `SkinInlineBtn`（仅 Vault 右下 `Button('+')` FAB 保留原生，见 §4）。
5. 图标：`SkinIcon` / `SkinIconButton` 改 SVG 资源（`$r('app.media.ic_*')`）+ `fillColor` 跟随皮肤；顶栏 4 图标、同步 FAB、管理/安全/外观/退出全部生效。
6. 删除类按钮改 `accent` 强调色实心（WCAG-AA 字色）。
7. 8 位颜色格式修正：ArkUI 组件色是 `#AARRGGBB`（透明在前），旧 `#RRGGBBAA` 写法已全部修掉（遮罩/投影/卡片投影）。
8. 文档与自检页：`harmony/docs/build-cli.md`（构建 + 踩坑 + 组件清单 + 自检页用法）、`harmony/docs/probes/SkinProbe.ets`（免登录自检页，图标资源/遮罩点阵/行内按钮/5 套皮肤切换）。

---

## 4. 待办（按优先级）

### P0 - Unlock 页两个引导弹层的真机视觉确认
- 位置：`pages/Unlock.ets` 的「生物识别设置引导」与「PIN 设置」两个弹层（已接入 SkinScrim + SkinInlineBtn + 描边投影，但**只做了编译验证**）。
- 原因：App 已登录态，不便退出重登，所以没截到图。
- 做法：临时把 `EntryAbility.ets` 的 `loadContent('pages/Index')` 改成 `'pages/Unlock'`（或注册一个临时路由），装上后走一遍解锁流程、打开这两个弹层截图；确认后还原。
- 验收：遮罩点阵可见、面板居中、按钮等宽、深色模式下描边清晰。

### P1 - 「切皮肤后底纹网格短暂变黄」定位与修复（低概率复现）
- 现象：App 运行中从 lab 深色切到 hud 浅色后，`SkinBackdrop` 的 8px 网格变成亮黄绿色；冷启动恢复正常。
- 已确认：与删除按钮/强调色的改动无关（`SkinBackdrop` 代码未动，diff 已核）。
- 怀疑方向：`SkinBackdrop` 的 Canvas 在 `@Watch('onSkinChanged')` 重绘时读到的 `ctx.width/height` 或颜色状态在布局切换瞬间不稳定；也可能与同屏多个 Canvas（SkinBackdrop + SkinScrim）的生命周期有关。
- 做法：先稳定复现（连续切 5 套皮肤 × 明暗，截图）；若复现，改为「尺寸变化后下一帧重绘」（例如 `setTimeout(() => this.drawTexture(), 0)` 或延迟到 `onAreaChange` 再画），或改用 `Image + ImageRepeat.XY` 的平铺纹理方案（需先确认 `$r` 资源加载，见 build-cli.md）。
- 验收：连续切换 5 套皮肤 × 2 明暗各 10 次，底纹颜色始终正确。

### P2 - 字体内嵌（完全对齐 Web 排版）
- 现状：`theme.ets` 的 `fontSans` 走系统字体栈（HarmonyOS Sans 等），与 Web 端（Bahnschrift / Georgia / 等宽字体组合）不完全一致。
- 任务：挑选并内嵌 1–2 个开源可商用字体（如等宽：JetBrains Mono / IBM Plex Mono；衬线：Source Serif），放 `resources/rawfile/` 或 `resources/base/media/`，用 `font.registerFont` 注册后用 `fontFamily` 引用。
- 注意：字体授权与包体大小（当前 HAP 约 1.1 MB）；需 `池` 确认字体选型与授权。
- 验收：hud/blueprint 的等宽小字与 mono 的衬线标题在真机上与 Web 截图并排比对。

### P3 - 收尾清理
- `pages/Vault.ets` 里「build b20261001-02（验收后移除）」标记行，验收后删除。
- Vault 右下 `Button('+')`（FAB）仍是原生 Button：可保留（已用皮肤令牌），也可改成 `Stack + SkinIcon` 统一按压反馈。
- 残留转换脚本 `harmony/tools/add_scrim.py`、`convert_buttons.mjs/py` 可择机清理（确认无引用后删除）。

### P4 - 后续新需求
UI 迭代以 `theme.ets` 令牌 + `SkinChrome.ets` 组件为入口；新页面直接复用组件，不要硬编码色值。

---

## 5. 硬约束（改 UI 前必读）

1. **逐处 `edit`，禁止批量脚本/正则改写**。历史上批量替换把「编辑/删除」行内按钮撑坏过一次。
2. **资源引用必须 `$r('app.media.xxx')` / `$rawfile(...)`**，不能传字符串（`Image('app.media.x')` 会被当网络地址，静默空白）。
3. **ArkUI 8 位颜色是 `#AARRGGBB`（透明在前）**；`#RRGGBBAA` 会让 alpha 变成前两位（几乎透明）。
4. **Canvas 2D 的颜色字符串按 Web CSS 语义（透明在后）**，和组件颜色不同源；Canvas 里用 `rgba(r,g,b,a)` 最稳。
5. **自定义组件实例不能直接 `.layoutWeight()`**；并排按钮写成 `Row(){ SkinInlineBtn(...) }.layoutWeight(1)`。
6. ArkTS 约束：方法名不能与内置属性重名（如 `.id()`）、没有 `FontWeight.Light`、禁止 `Record` 字面量、对象字面量要写类型。
7. 页面/组件不要硬编码颜色，统一走 `theme.ets`；描边/投影/遮罩用 `SkinChrome.ets` 的辅助函数。
8. 提交前必须 `assembleHap` BUILD SUCCESSFUL；改完 UI 要真机截图，不能只看编译。

---

## 6. 验证流程（改完必做）

```powershell
# 1) 构建 + 装机 + 启动 + 截图（一条龙，内部串行锁）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\dsh\kb-dev\dev.ps1 -Action all -Name after-change

# 2) 解锁 App（人工），然后截图
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\dsh\kb-dev\dev.ps1 -Action shot -Name vault

# 3) 点击（坐标 = 1600×2560 物理像素）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\dsh\kb-dev\dev.ps1 -Action tap -X 223 -Y 1062
```

常用坐标参考（1600×2560，具体以当次截图为准）：
- 顶栏图标（从左到右）：管理 ≈ (1270,361) / 安全 ≈ (1360,361) / 外观 ≈ (1447,361) / 退出 ≈ (1543,361)
- 分类下拉「全部 ▾」≈ (1150,361)
- 第一张卡片「编辑」≈ (223,1062)
- 外观面板：皮肤行 y≈1008/1084/1160/1236，明暗行 y≈1498，完成 y≈1622

验收截图存放：`G:\dsh\kb-dev\shots\`（脚本输出路径以命令行 SHOT 行为准）。

---

## 7. 交付验收清单

- [ ] `assembleHap` BUILD SUCCESSFUL，无新增 ArkTS 报错
- [ ] 真机装机成功，App 可正常解锁进入密钥库
- [ ] 5 套皮肤 × 明暗切换：底色/卡片/按钮/图标/遮罩全部跟随，无残留旧色
- [ ] 弹层：遮罩点阵可见、无双重压暗、面板描边/投影正常、按钮等宽不撑破
- [ ] 图标：顶栏 4 图标 + 同步 FAB + 图标按钮均正常显示（无空白）
- [ ] P0–P3 对应项完成并截图留证
- [ ] `git status` 干净，提交信息按 `feat(harmony):` / `fix(harmony):` / `docs(harmony):` 前缀

---

## 8. 参考文件

| 文件 | 说明 |
|---|---|
| `harmony/entry/src/main/ets/lib/theme.ets` | 唯一色值来源（5 皮肤 × 明暗） |
| `harmony/entry/src/main/ets/components/SkinChrome.ets` | 全部皮肤组件 + 辅助函数 |
| `harmony/entry/src/main/ets/pages/Vault.ets` | 主页面（卡片/弹层/分类/外观，改动最多） |
| `harmony/entry/src/main/ets/pages/{Admin,Unlock,Register,Index}.ets` | 其余页面 |
| `harmony/entry/src/main/ets/components/SecurityPanel.ets` | 安全面板 |
| `harmony/docs/build-cli.md` | 命令行构建 + ArkTS/资源/颜色踩坑 + 组件清单 |
| `harmony/docs/probes/SkinProbe.ets` | 免登录自检页（验证 UI 组件用，不参与正式路由） |

需要看历史改动：`git log --oneline -- harmony/`（最近 6 个提交均为皮肤化工作）。
