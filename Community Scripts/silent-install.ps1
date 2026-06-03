# Run this script in a powershell with administrator rights (run as administrator)
[CmdletBinding()]
param(
    # Latest stable version of NefCon installer
    [Parameter(Mandatory=$false)]
    [string]$NefConURL = "https://github.com/nefarius/nefcon/releases/download/v1.17.40/nefcon_v1.17.40.zip",
    
    # Latest stable version of VDD driver only
    [Parameter(Mandatory=$false)]
    [string]$DriverURL = "https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip"
);

# Create temp directory
$tempDir = $PSScriptRoot;
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null;

# Define path to nefcon executable
$NefConExe = Join-Path $tempDir "x64\nefconc.exe";
# Download and run DevCon Installer
if (-not (Test-Path $NefConExe))
{
    $NefConZipPath = Join-Path $tempDir "nefcon.zip";
    if (-not (Test-Path $NefConZipPath))
    {
        Write-Host "Downloading NefCon..." -ForegroundColor Cyan;
        Invoke-WebRequest -Uri $NefConURL -OutFile $NefConZipPath -UseBasicParsing -ErrorAction Stop;
    }
    Write-Host "extracting NefCon..." -ForegroundColor Cyan;
    Expand-Archive -Path $NefConZipPath -DestinationPath $tempDir -Force -ErrorAction Stop;
    Write-Host "extracting NefCon Completed..." -ForegroundColor Cyan;
}

# Check if VDD is installed. Or else, install it
$check = & $NefConExe --find-hwid ---hardware-id "Root\MttVDD";
if ($check -match "Virtual Display Driver") {
    Write-Host "Virtual Display Driver already present. No installation." -ForegroundColor Green;
} else {
    # Extract the signPath certificates
    $catFile = Join-Path $tempDir 'VirtualDisplayDriver\mttvdd.cat';
    if (-not (Test-Path $catFile)){
        # Download and unzip VDD
        $driverZipPath = Join-Path $tempDir 'driver.zip';
        if (-not (Test-Path $driverZipPath))
        {
            Write-Host "Downloading VDD..." -ForegroundColor Cyan;
            Invoke-WebRequest -Uri $DriverURL -OutFile $driverZipPath;
        }
        Expand-Archive -Path $driverZipPath -DestinationPath $tempDir -Force;
    }

    # Extract the SignPath certificates
    Write-Host "Extracting SignPath certificates..." -ForegroundColor Cyan;
    $signature = Get-AuthenticodeSignature -FilePath $catFile;
    $catBytes = [System.IO.File]::ReadAllBytes($catFile);
    $certificates = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2Collection;
    $certificates.Import($catBytes);

    # Create the temp directory for certificates
    $certsFolder = Join-Path $tempDir "ExportedCerts";
    if (-not (Test-Path $certsFolder))
    {
        New-Item -ItemType Directory -Path $certsFolder -Force | Out-Null;
    }
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
    Start-Sleep -Seconds 2;
    Pop-Location;

    Write-Host "Driver installation completed." -ForegroundColor Green;
}
#Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue;
