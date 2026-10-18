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

## 主题层说明

`entry/src/main/ets/lib/theme.ets` 是唯一色值来源（5 套皮肤 × 明暗）；
`entry/src/main/ets/components/SkinChrome.ets` 提供 `SkinBar`（顶栏信息条）与 `SkinWordmark`（页头词标），
两者自己订阅 `AppStorage('skin' | 'darkMode' | 'systemDark')`，页面只需放一行。
