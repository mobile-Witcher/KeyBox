<#
  KeyBox Windows 一键安装（MSIX）
  用法：右键本文件 → 使用 PowerShell 运行（或双击 一键安装.cmd）。
  它会自动申请管理员权限（一次 UAC 确认），因为 Windows 要求签名根证书装在【本机】受信任区。
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1) 自我提权
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host '需要管理员权限来安装证书，正在申请（请在弹出的窗口点“是”）...' -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'))
    exit
}

$msix = Get-ChildItem $here -Filter '*.msix' | Select-Object -First 1
if (-not $msix) { Write-Host '未找到 .msix 文件，请确保它与本脚本在同一目录。' -ForegroundColor Red; Read-Host '按回车退出'; exit 1 }
$cers = @(Get-ChildItem $here -Filter '*.cer')

Write-Host '[1/3] 导入签名证书到 本机 受信任发布者 与 受信任根 ...' -ForegroundColor Cyan
foreach ($c in $cers) {
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $c.FullName
    foreach ($sn in @('TrustedPeople', 'Root')) {
        $st = New-Object System.Security.Cryptography.X509Certificates.X509Store($sn, 'LocalMachine')
        $st.Open('ReadWrite')
        if (-not ($st.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })) { $st.Add($cert) }
        $st.Close()
        Write-Host ('      ' + $cert.Subject + ' -> LocalMachine\' + $sn)
    }
}

Write-Host '[2/3] 清理可能存在的旧版本 ...' -ForegroundColor Cyan
$old = Get-AppxPackage | Where-Object { $_.Name -match 'KeyBox' }
if ($old) { $old | Remove-AppxPackage -ErrorAction SilentlyContinue; Write-Host '      已移除旧包' }

Write-Host '[3/3] 安装应用包 ...' -ForegroundColor Cyan
try {
    Add-AppxPackage -Path $msix.FullName -ErrorAction Stop
    Write-Host '安装成功！在开始菜单搜索 KeyBox 即可启动。' -ForegroundColor Green
} catch {
    Write-Host ('安装失败：' + $_.Exception.Message) -ForegroundColor Red
    Write-Host '如果提示根证书不受信任，请确认 msix 与 cer 来自同一个发布版本。' -ForegroundColor Yellow
}
Read-Host '按回车退出'