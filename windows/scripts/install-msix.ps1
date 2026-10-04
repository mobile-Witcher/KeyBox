$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host '需要管理员权限安装证书（Windows 硬性要求），正在申请，请在弹窗点【是】...' -ForegroundColor Yellow
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '"' + $PSCommandPath + '"')
    Start-Process powershell -Verb RunAs -ArgumentList $args
    exit
}
Write-Host '=== KeyBox 安装（管理员模式）===' -ForegroundColor Cyan
$msix = Get-ChildItem $here -Filter '*.msix' | Select-Object -First 1
if (-not $msix) { Write-Host '未找到 .msix，请与脚本放在同一目录。' -ForegroundColor Red; Read-Host '按回车退出'; exit 1 }
foreach ($c in @(Get-ChildItem $here -Filter '*.cer')) {
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $c.FullName
    foreach ($sn in @('TrustedPeople', 'Root')) {
        $st = New-Object System.Security.Cryptography.X509Certificates.X509Store($sn, 'LocalMachine')
        $st.Open('ReadWrite')
        if (-not ($st.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })) { $st.Add($cert) }
        $st.Close()
        Write-Host ('  证书已导入: ' + $cert.Subject + ' -> LocalMachine' + [char]92 + $sn)
    }
}
Get-AppxPackage | Where-Object { $_.Name -match 'KeyBox' } | ForEach-Object { Remove-AppxPackage -Package $_.PackageFullName -ErrorAction SilentlyContinue; Write-Host '  已移除旧版本' }
try {
    Add-AppxPackage -Path $msix.FullName -ErrorAction Stop
    Write-Host '安装成功！请在开始菜单搜索 KeyBox 启动。' -ForegroundColor Green
} catch {
    Write-Host ('安装失败：' + $_.Exception.Message) -ForegroundColor Red
}
Read-Host '按回车退出'