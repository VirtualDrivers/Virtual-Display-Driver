@echo off
chcp 65001

:: Use PowerShell for elevation check and execution
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$elevated = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] 'Administrator');" ^
    "if (-not $elevated) {" ^
        "$CommandLine = '-File \"' + $MyInvocation.MyCommand.Path + '\" ' + $MyInvocation.UnboundArguments;" ^
        "Start-Process -FilePath PowerShell.exe -Verb Runas -ArgumentList $CommandLine;" ^
        "Exit" ^
    "} else {" ^
        "Install-Module -Name DisplayConfig -Scope AllUsers -Force -AllowClobber;" ^
        "Install-Module -Name MonitorConfig -Scope AllUsers -Force -AllowClobber;" ^
        "if ($?) {" ^
            "Write-Output 'Modules installed successfully.'" ^
        "} else {" ^
            "Write-Output 'An error occurred while installing the modules.'" ^
        "}" ^
    "}"
