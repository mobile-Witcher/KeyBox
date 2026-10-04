<#
.SYNOPSIS
    Package KeyBox Windows app as an MSIX (unsigned, sideload-ready).

.DESCRIPTION
    Uses the Windows App SDK single-project MSIX flow. MakeAppx / SignTool come
    from the Microsoft.Windows.SDK.BuildTools NuGet package, so the Windows SDK
    does NOT need to be installed on the build machine.

    Output: artifacts\KeyBox-<Version>-<Platform>.msix

    The produced package is UNSIGNED (CI holds no certificate). Windows requires
    a signature to install; see README ("Install (unsigned sideload)") for the
    self-sign + sideload steps.

    NOTE: kept ASCII-only on purpose so it parses identically under Windows
    PowerShell 5.1 (ANSI default) and PowerShell 7 (UTF-8 default).

.EXAMPLE
    pwsh -File scripts/package-msix.ps1
    pwsh -File scripts/package-msix.ps1 -Version 0.1.0.0 -Platform x64
#>
[CmdletBinding()]
param(
    [string] $Version = "0.1.0.0",
    [string] $Configuration = "Release",
    [string] $Platform = "x64",
    [string] $ArtifactsDir = "artifacts"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
    Write-Host "==> Restoring dependencies" -ForegroundColor Cyan
    # Native-command stderr becomes a terminating error under ErrorActionPreference=Stop;
    # merge it into the success stream with 2>&1.
    dotnet restore "$repoRoot\src\KeyBox.App\KeyBox.App.csproj" 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet restore failed (exit code $LASTEXITCODE)"
    }

    Write-Host "==> Publishing MSIX (unsigned, sideload only)" -ForegroundColor Cyan
    dotnet publish "$repoRoot\src\KeyBox.App\KeyBox.App.csproj" `
        -c $Configuration `
        -p:Platform=$Platform `
        -p:WindowsPackageType=MSIX `
        -p:AppxPackageSigningEnabled=false `
        -p:AppxBundle=Never `
        -p:UapAppxPackageBuildMode=SideloadOnly `
        -p:GenerateAppxPackageOnBuild=true 2>&1 | Out-Host

    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed (exit code $LASTEXITCODE)"
    }

    $produced = Get-ChildItem -Path "$repoRoot\src\KeyBox.App\bin" -Filter *.msix -Recurse |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $produced) {
        throw "No .msix artifact was produced"
    }

    New-Item -ItemType Directory -Force -Path "$repoRoot\$ArtifactsDir" | Out-Null
    $target = Join-Path "$repoRoot\$ArtifactsDir" "KeyBox-$Version-$Platform.msix"
    Copy-Item -Path $produced.FullName -Destination $target -Force

    $sizeMb = [math]::Round((Get-Item $target).Length / 1MB, 2)
    Write-Host "==> Package ready: $target ($sizeMb MB)" -ForegroundColor Green
    Write-Host "    UNSIGNED - see README 'Install (unsigned sideload)'" -ForegroundColor Yellow
}
finally {
    Pop-Location
}
