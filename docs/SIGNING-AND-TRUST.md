# 在另一台电脑上「安装 / 信任 / 签名」KeyBox —— 操作手册

> 适用：拿到 KeyBox 产物要在**别的电脑**上安装（Windows MSIX），或在**别的电脑**上重新构建签名包（Windows / Android / HarmonyOS）。
> 本文只涉及**公开证书**（`.cer`）与**构建配置**；**私钥与密码一律不入库**（见 §四）。

---

## 一、在另一台电脑安装 Windows 版（MSIX）

我们的 MSIX 用**自签名代码签名证书**（`CN=KeyBox`）。自签名的信任范围只覆盖「导入了该证书的电脑」，所以每台新电脑先做一次信任，之后随便装。

### 步骤 1｜下载两个文件
从 [KeyBox-Windows Releases](https://github.com/mobile-Witcher/KeyBox-Windows/releases) 下载：
- `KeyBox-0.4.0-win-x64.msix`（安装包）
- 仓库里的证书：`docs/certs/keybox-codesign.cer`（在同一仓库网页直接下载）

### 步骤 2｜信任证书（**管理员** PowerShell，只需一次）
```powershell
Import-Certificate -FilePath .\keybox-codesign.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```
> 放 `TrustedPeople` 即可（**不要**放「受信任的根证书颁发机构」，没必要且风险更大）。

### 步骤 3｜安装
```powershell
Add-AppxPackage -Path .\KeyBox-0.4.0-win-x64.msix
```
也可以直接双击 `.msix`。

> **前置条件**：Win11 → 设置 → 系统 → 开发者选项 → 允许「旁加载应用/开发人员模式」。
> 若单位策略锁死了旁加载，请让管理员用组策略放行，或改用免安装版（`dotnet publish` 输出目录直接运行 `KeyBox.App.exe`）。

### 校验（可选，推荐）
```powershell
Get-AppxPackage *KeyBox* | Select-Object Name, Version, InstallLocation
# 验签：装了证书后应输出 Successfully verified
& "$env:USERPROFILE\.nuget\packages\microsoft.windows.sdk.buildtools\10.0.22621.756\bin\10.0.22621.0\x64\signtool.exe" verify /pa .\KeyBox-0.4.0-win-x64.msix
```

### 卸载旧版 / 排错
```powershell
Get-AppxPackage *KeyBox* | Remove-AppxPackage          # 卸载
```
| 报错 | 原因 | 处理 |
|---|---|---|
| `0x800B0109` 证书链不受信任 | 没做步骤 2，或导错存储区 | 重做步骤 2（`LocalMachine\TrustedPeople`） |
| `0x80073CFF` / 需要旁加载 | 未开开发者模式 | 开旁加载/开发人员模式 |
| `0x80073CF3` 签名不匹配 | 包与证书 Publisher 不一致 | 用同版本发布的 `.cer`；不要混用他人证书 |

---

## 二、在另一台电脑**构建并签名**（开发者）

### Windows（代码签名）
1. 把 `keybox-codesign.pfx`（**私钥，含密码，另行安全传递，绝不走 git**）放到本机非仓库目录，例如 `%USERPROFILE%\.keybox\`。
2. 打包与签名：
```powershell
# 1) 打包（未签名 sideload 包）
.\scripts\package-msix.ps1 -Version 0.4.0.0 -Platform x64

# 2) 签名（SHA256 + RFC3161 时间戳；时间戳保证证书过期后签名仍有效）
& "$env:USERPROFILE\.nuget\packages\microsoft.windows.sdk.buildtools\10.0.22621.756\bin\10.0.22621.0\x64\signtool.exe" `
  sign /fd SHA256 /f "$env:USERPROFILE\.keybox\keybox-codesign.pfx" /p "<pfx 密码>" `
  /tr http://timestamp.digicert.com /td SHA256 .\artifacts\KeyBox-0.4.0.0-x64.msix
```
> ⚠️ MSIX 清单里的 `Publisher` 必须与证书 `Subject` **完全一致**（本项目两者都是 `CN=KeyBox`），否则签名会因主体不匹配被拒。

### Android（keystore）
1. 把 `keybox-release.jks` 放到仓库根（**已被 .gitignore**），同目录建 `key.properties`：
```properties
storeFile=keybox-release.jks
storePassword=<密码>
keyAlias=keybox
keyPassword=<密码>
```
2. 构建与验签：
```powershell
$env:JAVA_HOME='C:\Program Files\Java\jdk-17.0.5'    # keytool 需要
.\gradlew.bat :app:assembleRelease
& "$env:ANDROID_HOME\build-tools\<版本>\apksigner.bat" verify --print-certs .\app\build\outputs\apk\release\app-release.apk
```
> ⚠️ **必须用同一把 keystore**：换了密钥，老用户无法覆盖安装（只能卸载重装，本地 PIN/生物识别包裹会清空，云端密钥库数据不受影响）。
> ⚠️ `key.properties` 若由 PowerShell 写出，务必**无 BOM**（`[System.IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))`）；带 BOM 时 gradle 读不到配置，会静默产出 **unsigned** 包。

### HarmonyOS（DevEco 证书）
1. DevEco Studio → **File → Project Structure → Signing Configs** 勾选自动签名（会写入 `~/.ohos/config/` 并在 `build-profile.json5` 生成 `signingConfigs`）。
2. 命令行出包：
```powershell
$env:DEVECO_SDK_HOME='C:\Program Files\Huawei\DevEco Studio\sdk'
hvigorw assembleHap --mode module -p product=default
# 产物：entry/build/default/outputs/default/entry-default-signed.hap
```

---

## 三、验收清单（照着勾）

- [ ] 新电脑已导入 `keybox-codesign.cer` 到 `LocalMachine\TrustedPeople`
- [ ] `signtool verify /pa` 输出 `Successfully verified`
- [ ] `Add-AppxPackage` 安装成功，开始菜单图标为**鼠尾草绿挂锁**
- [ ] 四端图标一致（Windows 窗口左上角 / 托盘 / 安卓 launcher / 鸿蒙桌面 / 网页 favicon）
- [ ] 构建机已放入 `keybox-release.jks` 与 `keybox-codesign.pfx`，且**都不在 git 里**
- [ ] Android `apksigner verify` 通过；HarmonyOS 产物为 `*-signed.hap`

---

## 四、密钥保管（最重要）

| 材料 | 用途 | 丢失后果 | 存放 |
|---|---|---|---|
| `keybox-release.jks` + 密码 | 安卓发布签名 | **永远无法更新已发布的安卓应用** | 密码管理器 + 离线备份 |
| `keybox-codesign.pfx` + 密码 | Windows MSIX 签名 | 已安装用户需重新信任新证书 | 密码管理器 + 离线备份 |
| `keybox-codesign.cer` | **公开**，供他人信任 | 无 | 本仓库 `docs/certs/` ✔ 已入库 |
| DevEco 证书（`~/.ohos/config/`） | 鸿蒙签名 | 平台侧可重新申请 | DevEco 管理 |

**绝不要**：把 `.pfx` / `.jks` / `key.properties` / 任何明文密码提交进 git、贴进 issue、或写进文档。
仓库 `.gitignore` 已忽略 `key.properties`、`*.jks`、`*.pfx` 与 `secrets/`；提交前用 `git status` 复核一遍。
