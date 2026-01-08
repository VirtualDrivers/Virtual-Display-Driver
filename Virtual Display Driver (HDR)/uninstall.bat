@echo off
echo Uninstalling MttVDD test driver...
pnputil /enum-drivers | findstr /i "MttVDD"
echo.
echo Deleting driver package...
pnputil /delete-driver oem??_mttvdd.inf /uninstall /force
echo Removing test certificate...
certutil -delstore Root "MttVDD Test Root" 2>nul
echo Done. Reboot recommended.
pause

