# Run this script in a powershell with administrator rights (run as administrator)
[CmdletBinding()]
param(

);

# Create temp directory
$tempDir = $PSScriptRoot;
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null;
$NefConExe = Join-Path $tempDir "x64\nefconc.exe";
Push-Location $tempDir;
& $NefConExe remove "Root\MttVDD";
& $NefConExe --uninstall-driver --inf-path .\VirtualDisplayDriver\VirtualDisplayDriver.inf;
Write-Host "Driver installation removed." -ForegroundColor Green;
Pop-Location;

