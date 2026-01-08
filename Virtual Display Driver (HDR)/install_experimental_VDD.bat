@echo off
echo ==================================================
echo VDD experimental Installer - Multi-Card Branch
echo ==================================================
echo.
echo Installing test certificate...
certutil -addstore root "%~dp0MttVDD.cer" >nul 2>&1
certutil -addstore -f TrustedPublisher "%~dp0MttVDD.cer"
if %errorlevel% neq 0 (
    echo ERROR: Failed to install certificate. Are you running as Administrator?
    pause
    exit /b 1
) else (
    echo [OK] Test certificate installed (Root store)
)

echo.
echo Verifying required files...
if not exist "%~dp0MttVDD.cat" (
    if exist "%~dp0mttvdd.cat" (
        echo Catalog file found with lowercase name, ensuring correct case...
        copy "%~dp0mttvdd.cat" "%~dp0MttVDD.cat" >nul 2>&1
    ) else (
        echo ERROR: Catalog file (MttVDD.cat) not found!
        echo This is required for driver installation with PnpLockdown enabled.
        pause
        exit /b 1
    )
)
if not exist "%~dp0MttVDD.dll" (
    echo ERROR: Driver DLL (MttVDD.dll) not found!
    pause
    exit /b 1
)

echo.
echo Installing driver...
pnputil /add-driver "%~dp0MttVDD.inf" /install
if %errorlevel% neq 0 (
    echo ERROR: Driver installation failed. Reboot might be needed.
	echo -----
	echo Try manual installation in DeviceManager, Action, Legacy...
    pause
    exit /b 1
) else (
    echo [OK] Driver installed successfully!
)
set "FOLDER=C:\VirtualDisplayDriver"
set "NEWFILE=vdd_settings.xml"
set "OLDFILE=old_vdd_settings.xml"

if exist "%FOLDER%" (
    if exist "%FOLDER%\%NEWFILE%" (
        ren "%FOLDER%\%NEWFILE%" "%FOLDER%\%OLDFILE%"
    ) else (
        copy %NEWFILE%" %FOLDER%\%NEWFILE%
    )
) else (
    md %FOLDER%
    copy %NEWFILE%" %FOLDER%\%NEWFILE%
)
copy "%~dpuninstall.bat" %FOLDER%
copy "%~dpMttVDD.inf" %FOLDER%
copy "%~dpMttVDD.dll" %FOLDER%
copy "%~dpMttVDD.cer" %FOLDER%
copy "%~dpmttvdd.cat" %FOLDER%
copy "%~dpinstall_experimental_VDD.bat" %FOLDER%

echo.
echo ==================================================
echo Feedback is really appricated.
echo ==================================================
pause