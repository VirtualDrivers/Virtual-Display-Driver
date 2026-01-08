# Run this script in a powershell with administrator rights (run as administrator)
[CmdletBinding()]
param(
    # Latest stable version of NefCon installer
    [Parameter(Mandatory=$false)]
    [string]$NefConURL = "https://github.com/nefarius/nefcon/releases/download/v1.14.0/nefcon_v1.14.0.zip",
    
    # Latest stable version of VDD driver only
    [Parameter(Mandatory=$false)]
    [string]$DriverURL = "https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip"
);

# Create temp directory
$tempDir = Join-Path $env:TEMP "VDDInstall";
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null;

# Download and unzip NefCon
Write-Host "Downloading and extracting NefCon..." -ForegroundColor Cyan;
$NefConZipPath = Join-Path $tempDir "nefcon.zip";
Invoke-WebRequest -Uri $NefConURL -OutFile $NefConZipPath -UseBasicParsing -ErrorAction Stop;
Expand-Archive -Path $NefConZipPath -DestinationPath $tempDir -Force -ErrorAction Stop;
$NefConExe = Join-Path $tempDir "x64\nefconw.exe";

# Download and unzip VDD
Write-Host "Downloading and extracting VDD..." -ForegroundColor Cyan;
$driverZipPath = Join-Path $tempDir 'driver.zip';
Invoke-WebRequest -Uri $DriverURL -OutFile $driverZipPath;
Expand-Archive -Path $driverZipPath -DestinationPath $tempDir -Force;

# Extract the SignPath certificates
Write-Host "Extracting SignPath certificates..." -ForegroundColor Cyan;
$catFile = Join-Path $tempDir 'VirtualDisplayDriver\mttvdd.cat';
$catBytes = [System.IO.File]::ReadAllBytes($catFile);
$certificates = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2Collection;
$certificates.Import($catBytes);

# Create the temp directory for certificates
$certsFolder = Join-Path $tempDir "ExportedCerts";
New-Item -ItemType Directory -Path $certsFolder -Force | Out-Null;

# Write and store the driver certificates on local machine
Write-Host "Installing driver certificates on local machine." -ForegroundColor Cyan;
foreach ($cert in $certificates) {
    $certFilePath = Join-Path -Path $certsFolder -ChildPath "$($cert.Thumbprint).cer";
    $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert) | Set-Content -Path $certFilePath -Encoding Byte;
    Import-Certificate -FilePath $certFilePath -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher";
}

# Install VDD
Write-Host "Installing Virtual Display Driver silently..." -ForegroundColor Cyan;
Push-Location $tempDir;
& $NefConExe install .\VirtualDisplayDriver\MttVDD.inf "Root\MttVDD";
Pop-Location;

Write-Host "Driver installation completed." -ForegroundColor Green;
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue;
