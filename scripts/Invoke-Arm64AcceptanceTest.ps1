#Requires -Version 5.1
<#
.SYNOPSIS
    Runs Surface acceptance checks for a Microsoft-signed ARM64 MttVDD package.

.DESCRIPTION
    Preflight mode verifies Secure Boot and HVCI remain enabled and validates the package
    with Release policy. Install mode performs NefCon-based installation and display
    topology checks when Release validation succeeds.

.PARAMETER PackagePath
    Directory or CAB containing the Microsoft-signed ARM64 driver package.

.PARAMETER Mode
    Preflight - security and signature validation only (default)
    Install   - install driver and verify device/display topology when signature gate passes

.PARAMETER NefConPath
    Optional path to nefconw.exe. Defaults to ARM64 binary extracted from the latest NefCon release.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$PackagePath,

    [ValidateSet('Preflight', 'Install')]
    [string]$Mode = 'Preflight',

    [string]$NefConPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-SecurityGates {
    $results = @()

    $secureBoot = $false
    try {
        $secureBoot = Confirm-SecureBootUEFI -ErrorAction Stop
    }
    catch {
        $reg = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' -Name UEFISecureBootEnabled -ErrorAction SilentlyContinue
        $secureBoot = ($reg.UEFISecureBootEnabled -eq 1)
    }

    $results += [pscustomobject]@{
        Check  = 'SecureBoot'
        Status = $(if ($secureBoot) { 'PASS' } else { 'FAIL' })
        Detail = $(if ($secureBoot) { 'Secure Boot is enabled.' } else { 'Secure Boot is disabled or could not be verified.' })
    }

    $hvciEnabled = $false
    try {
        $ci = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard -ErrorAction Stop
        $hvciEnabled = ($ci.SecurityServicesRunning -contains 1) -or ($ci.VirtualizationBasedSecurityStatus -ge 2)
    }
    catch {
        $reg = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' -Name Enabled -ErrorAction SilentlyContinue
        $hvciEnabled = ($reg.Enabled -eq 1)
    }

    $results += [pscustomobject]@{
        Check  = 'HVCI'
        Status = $(if ($hvciEnabled) { 'PASS' } else { 'FAIL' })
        Detail = $(if ($hvciEnabled) { 'Memory Integrity / HVCI appears enabled.' } else { 'Memory Integrity / HVCI does not appear enabled.' })
    }

    return $results
}

function Get-DriverPackageDirectory {
    param(
        [string]$Path
    )

    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer) {
        $inf = Get-ChildItem -LiteralPath $item.FullName -Filter 'MttVDD.inf' -Recurse -File | Select-Object -First 1
        if (-not $inf) {
            throw "MttVDD.inf not found under $Path"
        }
        return $inf.Directory.FullName
    }

    $expandRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("vdd-arm64-accept-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $expandRoot -Force | Out-Null
    expand.exe $item.FullName -F:* $expandRoot | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to expand CAB: $Path"
    }

    $inf = Get-ChildItem -LiteralPath $expandRoot -Filter 'MttVDD.inf' -Recurse -File | Select-Object -First 1
    if (-not $inf) {
        throw "MttVDD.inf not found in expanded CAB."
    }

    return $inf.Directory.FullName
}

function Ensure-NefCon {
    param(
        [string]$ExplicitPath
    )

    if ($ExplicitPath) {
        if (-not (Test-Path -LiteralPath $ExplicitPath)) {
            throw "NefCon not found at $ExplicitPath"
        }
        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }

    $tempDir = Join-Path $env:TEMP 'VDDAcceptanceNefCon'
    $arm64Exe = Join-Path $tempDir 'ARM64\nefconw.exe'
    if (-not (Test-Path -LiteralPath $arm64Exe)) {
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        $zipPath = Join-Path $tempDir 'nefcon.zip'
        Invoke-WebRequest -Uri 'https://github.com/nefarius/nefcon/releases/download/v1.14.0/nefcon_v1.14.0.zip' -OutFile $zipPath -UseBasicParsing
        Expand-Archive -LiteralPath $zipPath -DestinationPath $tempDir -Force
    }

    if (-not (Test-Path -LiteralPath $arm64Exe)) {
        throw 'ARM64 nefconw.exe not found after extraction.'
    }

    return (Resolve-Path -LiteralPath $arm64Exe).Path
}

$validator = Join-Path $PSScriptRoot 'Test-Arm64DriverPackage.ps1'
if (-not (Test-Path -LiteralPath $validator)) {
    throw "Validation script not found: $validator"
}

Write-Host '=== ARM64 MttVDD acceptance preflight ===' -ForegroundColor Cyan
$securityResults = Test-SecurityGates
$securityResults | ForEach-Object {
    $color = if ($_.Status -eq 'PASS') { 'Green' } else { 'Red' }
    Write-Host ("[{0}] {1} - {2}" -f $_.Status, $_.Check, $_.Detail) -ForegroundColor $color
}

if (@($securityResults | Where-Object { $_.Status -eq 'FAIL' }).Count -gt 0) {
    throw 'Security gate failed. Acceptance testing requires Secure Boot and HVCI enabled.'
}

Write-Host '=== Release signature validation ===' -ForegroundColor Cyan
& $validator -PackagePath $PackagePath -Policy Release

if ($Mode -eq 'Preflight') {
    Write-Host 'Preflight acceptance checks passed. Install mode can proceed once a Microsoft-signed package is available.' -ForegroundColor Green
    return
}

$packageDir = Get-DriverPackageDirectory -Path $PackagePath
$nefcon = Ensure-NefCon -ExplicitPath $NefConPath
$infPath = Join-Path $packageDir 'MttVDD.inf'

Write-Host '=== Installing Root\MttVDD via NefCon ===' -ForegroundColor Cyan
Push-Location $packageDir
try {
    & $nefcon install $infPath 'Root\MttVDD'
    if ($LASTEXITCODE -ne 0) {
        throw "nefconw install failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Start-Sleep -Seconds 5

$pnpDevice = Get-PnpDevice -FriendlyName '*Virtual Display Driver*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pnpDevice) {
    $pnpDevice = Get-PnpDevice -InstanceId '*Root\MttVDD*' -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (-not $pnpDevice -or $pnpDevice.Status -ne 'OK') {
    throw 'MttVDD device not present or not healthy after install.'
}

Write-Host ("Device {0} status: {1}" -f $pnpDevice.InstanceId, $pnpDevice.Status) -ForegroundColor Green

try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MonitorEnumAcceptance {
    public delegate bool EnumMonitorsDelegate(IntPtr hMonitor, IntPtr hdcMonitor, ref RECT lprcMonitor, IntPtr dwData);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")]
    public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, EnumMonitorsDelegate lpfnEnum, IntPtr dwData);
    public static int CountMonitors() {
        int count = 0;
        EnumMonitorsDelegate callback = delegate (IntPtr hMonitor, IntPtr hdcMonitor, ref RECT lprcMonitor, IntPtr dwData) {
            count++;
            return true;
        };
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero);
        return count;
    }
}
"@
    $monitorCount = [MonitorEnumAcceptance]::CountMonitors()
    Write-Host "EnumDisplayMonitors reported $monitorCount monitors." -ForegroundColor Green
}
catch {
    Write-Warning "EnumDisplayMonitors probe unavailable: $($_.Exception.Message)"
}
Write-Host 'Install acceptance checks completed. Verify extended topology manually and test RealWarp 0.38.0 with XREAL One / One Pro.' -ForegroundColor Green
