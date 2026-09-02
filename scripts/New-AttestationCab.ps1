#Requires -Version 5.1
<#
.SYNOPSIS
    Creates a Partner Center-ready attestation CAB from ARM64 Release build output.

.DESCRIPTION
    Validates the ARM64 Release payload with CI policy, stages the driver into a short-path
    directory, and invokes MakeCab to produce a Microsoft-compatible submission CAB.

.PARAMETER InputDirectory
    ARM64 Release output directory containing MttVDD.inf, MttVDD.dll, MttVDD.pdb, and catalog.

.PARAMETER OutputDirectory
    Directory where MakeCab Disk1 output will be copied. Defaults to InputDirectory parent.

.PARAMETER PackageFolderName
    Single driver subfolder name inside the CAB. Must be fewer than 40 characters.

.PARAMETER CabFileName
    Output CAB file name.

.PARAMETER StagingRoot
    Optional short local path for MakeCab staging. Must not be a UNC path.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$InputDirectory,

    [string]$OutputDirectory,

    [ValidateLength(1, 39)]
    [string]$PackageFolderName = 'MttVDD',

    [string]$CabFileName = 'MttVDD-ARM64-Attestation.cab',

    [string]$StagingRoot = 'C:\VDDSubmit'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-ExistingPath {
    param(
        [string]$Path,
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label not found: $Path"
    }

    return (Resolve-Path -LiteralPath $Path).Path
}

function Get-CatalogPath {
    param(
        [string]$Directory
    )

    foreach ($name in @('MttVDD.cat', 'mttvdd.cat')) {
        $candidate = Join-Path $Directory $name
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "Catalog file not found in $Directory"
}

$validator = Join-Path $PSScriptRoot 'Test-Arm64DriverPackage.ps1'
if (-not (Test-Path -LiteralPath $validator)) {
    throw "Validation script not found: $validator"
}

$inputDir = Resolve-ExistingPath -Path $InputDirectory -Label 'InputDirectory'
& $validator -PackagePath $inputDir -Policy CI

if ($StagingRoot -match '^\\\\') {
    throw 'StagingRoot must be a mapped drive or local path; UNC paths are rejected by Partner Center attestation packaging.'
}

$requiredFiles = @('MttVDD.inf', 'MttVDD.dll', 'MttVDD.pdb')
foreach ($fileName in $requiredFiles) {
    Resolve-ExistingPath -Path (Join-Path $inputDir $fileName) -Label $fileName | Out-Null
}
$catalogPath = Get-CatalogPath -Directory $inputDir

if (-not $OutputDirectory) {
    $OutputDirectory = Split-Path -Parent $inputDir
}
$OutputDirectory = Resolve-ExistingPath -Path $OutputDirectory -Label 'OutputDirectory'

$stagingSession = Join-Path $StagingRoot ([guid]::NewGuid().ToString('N'))
$stagingPackage = Join-Path $stagingSession $PackageFolderName
New-Item -ItemType Directory -Path $stagingPackage -Force | Out-Null

try {
    Copy-Item -LiteralPath (Join-Path $inputDir 'MttVDD.inf') -Destination $stagingPackage -Force
    Copy-Item -LiteralPath (Join-Path $inputDir 'MttVDD.dll') -Destination $stagingPackage -Force
    Copy-Item -LiteralPath (Join-Path $inputDir 'MttVDD.pdb') -Destination $stagingPackage -Force
    Copy-Item -LiteralPath $catalogPath -Destination (Join-Path $stagingPackage ([System.IO.Path]::GetFileName($catalogPath))) -Force

    $ddfPath = Join-Path $stagingSession 'MttVDD-ARM64.ddf'
    $cabTemplate = [System.IO.Path]::GetFileNameWithoutExtension($CabFileName)
    $ddfLines = @(
        '; MttVDD ARM64 attestation submission'
        '.OPTION EXPLICIT'
        '.Set CabinetFileCountThreshold=0'
        '.Set FolderFileCountThreshold=0'
        '.Set FolderSizeThreshold=0'
        '.Set MaxCabinetSize=0'
        '.Set MaxDiskFileCount=0'
        '.Set MaxDiskSize=0'
        '.Set CompressionType=MSZIP'
        '.Set Cabinet=on'
        '.Set Compress=on'
        ".Set CabinetNameTemplate=$cabTemplate.cab"
        ".Set DestinationDir=$PackageFolderName"
        "$(Join-Path $stagingPackage 'MttVDD.inf')"
        "$(Join-Path $stagingPackage 'MttVDD.dll')"
        "$(Join-Path $stagingPackage 'MttVDD.pdb')"
        "$(Join-Path $stagingPackage ([System.IO.Path]::GetFileName($catalogPath)))"
    )
    Set-Content -LiteralPath $ddfPath -Value $ddfLines -Encoding ASCII

    Push-Location $stagingSession
    try {
        & makecab.exe /F $ddfPath
        if ($LASTEXITCODE -ne 0) {
            throw "makecab.exe failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    $disk1 = Join-Path $stagingSession 'disk1'
    $builtCab = Join-Path $disk1 ($cabTemplate + '.cab')
    if (-not (Test-Path -LiteralPath $builtCab)) {
        $builtCab = Get-ChildItem -LiteralPath $disk1 -Filter '*.cab' -File | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $builtCab -or -not (Test-Path -LiteralPath $builtCab)) {
        throw 'MakeCab completed but no CAB file was produced.'
    }

    $finalCab = Join-Path $OutputDirectory $CabFileName
    Copy-Item -LiteralPath $builtCab -Destination $finalCab -Force

    & $validator -PackagePath $finalCab -Policy CI

    [pscustomobject]@{
        CabPath            = (Resolve-Path -LiteralPath $finalCab).Path
        PackageFolderName  = $PackageFolderName
        StagingDirectory   = $stagingSession
        SourceDirectory    = $inputDir
    }
}
finally {
    if (Test-Path -LiteralPath $stagingSession) {
        Remove-Item -LiteralPath $stagingSession -Recurse -Force -ErrorAction SilentlyContinue
    }
}
