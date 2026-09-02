#Requires -Version 5.1
<#
.SYNOPSIS
    Validates an ARM64 MttVDD driver package directory or attestation CAB.

.DESCRIPTION
    CI policy validates architecture, required payload files, INF integrity, PE machine
    type, and version consistency. Release policy additionally requires a catalog that
    chains to Microsoft Windows Hardware Compatibility Publisher and rejects SignPath-only
    or test-signed catalogs.

.PARAMETER PackagePath
    Path to a driver package folder or a .cab file produced for Partner Center submission.

.PARAMETER Policy
    CI      - pre-submission validation (default)
    Release - post-Microsoft-signing validation before publication or install
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$PackagePath,

    [ValidateSet('CI', 'Release')]
    [string]$Policy = 'CI',

    [switch]$KeepExpandedCab
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Arm64MachineType = 0xAA64
$script:MicrosoftHardwarePublisher = 'Microsoft Windows Hardware Compatibility Publisher'
$script:RejectedSignerPatterns = @(
    'SignPath Foundation',
    'SignPath Test'
)
$script:RequiredInfMarkers = @(
    'PnpLockdown=1',
    'CatalogFile=MttVDD.cat',
    'UmdfExtensions = IddCx0102',
    'Root\MttVDD'
)
$script:RequiredPackageFiles = @(
    'MttVDD.inf',
    'MttVDD.dll',
    'MttVDD.pdb'
)
$script:RequiredCatalogNames = @(
    'MttVDD.cat',
    'mttvdd.cat'
)

function Write-ValidationResult {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail
    )

    $status = if ($Passed) { 'PASS' } else { 'FAIL' }
    [pscustomobject]@{
        Check  = $Name
        Status = $status
        Detail = $Detail
    }
}

function Resolve-PackageDirectory {
    param(
        [string]$Path,
        [switch]$KeepExpanded
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Package path not found: $Path"
    }

    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer) {
        return @{
            Directory    = $item.FullName
            ExpandedRoot = $null
            Cleanup      = $false
        }
    }

    if ($item.Extension -ne '.cab') {
        throw "PackagePath must be a directory or .cab file. Received: $Path"
    }

    $expandRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("vdd-arm64-cab-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $expandRoot -Force | Out-Null

    try {
        expand.exe $item.FullName -F:* $expandRoot | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "expand.exe failed with exit code $LASTEXITCODE while extracting $($item.FullName)"
        }
    }
    catch {
        Remove-Item -LiteralPath $expandRoot -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }

    if (-not $KeepExpanded) {
        return @{
            Directory    = $expandRoot
            ExpandedRoot = $expandRoot
            Cleanup      = $true
        }
    }

    return @{
        Directory    = $expandRoot
        ExpandedRoot = $null
        Cleanup      = $false
    }
}

function Get-DriverPackageRoot {
    param(
        [string]$RootDirectory
    )

    $infFiles = @(Get-ChildItem -LiteralPath $RootDirectory -Filter '*.inf' -Recurse -File -ErrorAction SilentlyContinue)
    if ($infFiles.Count -eq 0) {
        throw "No .inf files found under package root: $RootDirectory"
    }

    $mttInf = $infFiles | Where-Object { $_.Name -ieq 'MttVDD.inf' } | Select-Object -First 1
    if (-not $mttInf) {
        throw "Expected MttVDD.inf in package, found: $($infFiles.Name -join ', ')"
    }

    return @{
        PackageDirectory = $mttInf.Directory.FullName
        InfPath          = $mttInf.FullName
    }
}

function Test-CabLayout {
    param(
        [string]$RootDirectory
    )

    $rootEntries = @(Get-ChildItem -LiteralPath $RootDirectory -Force)
    $rootFiles = @($rootEntries | Where-Object { -not $_.PSIsContainer })
    if ($rootFiles.Count -gt 0) {
        return Write-ValidationResult -Name 'CabLayout' -Passed $false -Detail 'CAB must not contain files at the root; driver payload must live in a subfolder.'
    }

    $packageDirs = @($rootEntries | Where-Object { $_.PSIsContainer })
    if ($packageDirs.Count -ne 1) {
        return Write-ValidationResult -Name 'CabLayout' -Passed $false -Detail "Expected exactly one driver subfolder in CAB, found $($packageDirs.Count)."
    }

    if ($packageDirs[0].Name.Length -ge 40) {
        return Write-ValidationResult -Name 'CabLayout' -Passed $false -Detail "Driver folder name must be fewer than 40 characters for attestation submission: $($packageDirs[0].Name)"
    }

    Write-ValidationResult -Name 'CabLayout' -Passed $true -Detail "Single driver folder '$($packageDirs[0].Name)' present."
}

function Get-PeMachineType {
    param(
        [string]$BinaryPath
    )

    $bytes = [System.IO.File]::ReadAllBytes($BinaryPath)
    if ($bytes.Length -lt 0x40) {
        throw "Binary too small to parse PE header: $BinaryPath"
    }

    $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
    if ($peOffset -lt 0 -or ($peOffset + 6) -ge $bytes.Length) {
        throw "Invalid PE offset in binary: $BinaryPath"
    }

    return [BitConverter]::ToUInt16($bytes, $peOffset + 4)
}

function Get-InfDriverVersion {
    param(
        [string]$InfPath
    )

    $driverVerLine = Select-String -LiteralPath $InfPath -Pattern '^\s*DriverVer\s*=' -SimpleMatch:$false | Select-Object -First 1
    if (-not $driverVerLine) {
        return $null
    }

    $value = ($driverVerLine.Line -split '=', 2)[1].Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $null
    }

    return $value
}

function Test-InfContent {
    param(
        [string]$InfPath
    )

    $infText = Get-Content -LiteralPath $InfPath -Raw
    $results = @()

    foreach ($marker in $script:RequiredInfMarkers) {
        $passed = $infText -like "*$marker*"
        $results += Write-ValidationResult -Name "InfMarker:$marker" -Passed $passed -Detail $(if ($passed) { 'Present.' } else { 'Missing required INF marker.' })
    }

    $hasNtArm64 = ($infText -match '\[Standard\.NTARM64\]' -or $infText -match 'NTARM64')
    $hasAmd64Only = ($infText -match '\[Standard\.NTamd64\]' -or $infText -match ',NTamd64' -or $infText -match 'NTamd64\.10\.0')
    $archPassed = $hasNtArm64 -and -not $hasAmd64Only
    $results += Write-ValidationResult -Name 'InfArchitecture' -Passed $archPassed -Detail $(if ($archPassed) { 'INF targets NTARM64.' } else { 'INF must target NTARM64 and must not be amd64-only.' })

    return $results
}

function Test-RequiredFiles {
    param(
        [string]$PackageDirectory
    )

    $results = @()
    foreach ($fileName in $script:RequiredPackageFiles) {
        $path = Join-Path $PackageDirectory $fileName
        $passed = Test-Path -LiteralPath $path
        $results += Write-ValidationResult -Name "File:$fileName" -Passed $passed -Detail $(if ($passed) { 'Present.' } else { 'Missing required package file.' })
    }

    $catalogPath = $null
    foreach ($catalogName in $script:RequiredCatalogNames) {
        $candidate = Join-Path $PackageDirectory $catalogName
        if (Test-Path -LiteralPath $candidate) {
            $catalogPath = $candidate
            break
        }
    }

    $catalogPassed = [bool]$catalogPath
    $results += Write-ValidationResult -Name 'File:Catalog' -Passed $catalogPassed -Detail $(if ($catalogPassed) { "Present ($([System.IO.Path]::GetFileName($catalogPath)))." } else { 'Missing MttVDD.cat catalog file.' })

    return @{
        Results     = $results
        CatalogPath = $catalogPath
    }
}

function Test-PeArchitecture {
    param(
        [string]$DllPath
    )

    $machine = Get-PeMachineType -BinaryPath $DllPath
    $passed = ($machine -eq $script:Arm64MachineType)
    Write-ValidationResult -Name 'PeMachineType' -Passed $passed -Detail "Expected 0x$('{0:X4}' -f $script:Arm64MachineType), found 0x$('{0:X4}' -f $machine)."
}

function Test-VersionConsistency {
    param(
        [string]$InfPath,
        [string]$DllPath
    )

    $driverVer = Get-InfDriverVersion -InfPath $InfPath
    if (-not $driverVer) {
        return Write-ValidationResult -Name 'VersionConsistency' -Passed $false -Detail 'DriverVer is missing from INF.'
    }

    $fileVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($DllPath)
    $dllVersion = $fileVersion.ProductVersion
    if ([string]::IsNullOrWhiteSpace($dllVersion)) {
        $dllVersion = $fileVersion.FileVersion
    }
    if (-not [string]::IsNullOrWhiteSpace($dllVersion)) {
        $dllVersion = $dllVersion.Trim()
    }

    if ([string]::IsNullOrWhiteSpace($dllVersion) -or $dllVersion -eq '0.0.0.0') {
        return Write-ValidationResult -Name 'VersionConsistency' -Passed $true -Detail "INF DriverVer='$driverVer'; DLL version resource not stamped (acceptable when INF/catalog carry the release version)."
    }

    $passed = ($driverVer -match [regex]::Escape($dllVersion))
    Write-ValidationResult -Name 'VersionConsistency' -Passed $passed -Detail "INF DriverVer='$driverVer', DLL version='$dllVersion'."
}

function Get-CatalogCertificateSubjects {
    param(
        [string]$CatalogPath
    )

    $certificates = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2Collection
    $certificates.Import([System.IO.File]::ReadAllBytes($CatalogPath))
    return @($certificates | ForEach-Object { $_.Subject })
}

function Test-CatalogSignaturePolicy {
    param(
        [string]$CatalogPath,
        [string]$PolicyName
    )

    if (-not $CatalogPath) {
        return Write-ValidationResult -Name 'CatalogSignature' -Passed $false -Detail 'Catalog file not available for signature analysis.'
    }

    $subjects = @(Get-CatalogCertificateSubjects -CatalogPath $CatalogPath)
    if ($subjects.Count -eq 0) {
        return Write-ValidationResult -Name 'CatalogSignature' -Passed $false -Detail 'No certificates embedded in catalog.'
    }

    $subjectText = ($subjects -join ' | ')
    $hasMicrosoftPublisher = $subjects | Where-Object { $_ -like "*$($script:MicrosoftHardwarePublisher)*" }
    $hasRejectedSigner = $false
    foreach ($pattern in $script:RejectedSignerPatterns) {
        if ($subjects | Where-Object { $_ -like "*$pattern*" }) {
            $hasRejectedSigner = $true
            break
        }
    }

    if ($PolicyName -eq 'Release') {
        $passed = [bool]$hasMicrosoftPublisher -and -not $hasRejectedSigner
        $detail = if ($passed) {
            'Catalog chains to Microsoft Windows Hardware Compatibility Publisher.'
        }
        elseif ($hasRejectedSigner -and -not $hasMicrosoftPublisher) {
            'Catalog is SignPath/test-signed only; Microsoft hardware publisher signature required for HVCI-enabled install.'
        }
        else {
            "Catalog subjects: $subjectText"
        }
        return Write-ValidationResult -Name 'CatalogSignature' -Passed $passed -Detail $detail
    }

    return Write-ValidationResult -Name 'CatalogSignature' -Passed $true -Detail "CI policy records catalog subjects: $subjectText"
}

$expanded = Resolve-PackageDirectory -Path $PackagePath -KeepExpanded:$KeepExpandedCab
$results = @()

try {
    if ((Get-Item -LiteralPath $PackagePath).Extension -eq '.cab') {
        $results += Test-CabLayout -RootDirectory $expanded.Directory
    }

    $package = Get-DriverPackageRoot -RootDirectory $expanded.Directory
    $fileResults = Test-RequiredFiles -PackageDirectory $package.PackageDirectory
    $results += $fileResults.Results

    $results += Test-InfContent -InfPath $package.InfPath

    $dllPath = Join-Path $package.PackageDirectory 'MttVDD.dll'
    if (Test-Path -LiteralPath $dllPath) {
        $results += Test-PeArchitecture -DllPath $dllPath
        $results += Test-VersionConsistency -InfPath $package.InfPath -DllPath $dllPath
    }

    $results += Test-CatalogSignaturePolicy -CatalogPath $fileResults.CatalogPath -PolicyName $Policy

    $failed = @($results | Where-Object { $_.Status -eq 'FAIL' })
    $results | Format-Table -AutoSize | Out-String | Write-Verbose
    $results | ForEach-Object {
        $color = if ($_.Status -eq 'PASS') { 'Green' } else { 'Red' }
        Write-Host ("[{0}] {1} - {2}" -f $_.Status, $_.Check, $_.Detail) -ForegroundColor $color
    }

    if ($failed.Count -gt 0) {
        throw "ARM64 driver package validation failed ($Policy policy): $($failed.Check -join ', ')"
    }

    Write-Host "ARM64 driver package validation succeeded ($Policy policy)." -ForegroundColor Green
}
finally {
    if ($expanded.Cleanup -and $expanded.ExpandedRoot) {
        Remove-Item -LiteralPath $expanded.ExpandedRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
