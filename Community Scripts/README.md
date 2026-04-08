# Scripts

This folder contains community PowerShell helpers that were created alongside the driver. They are useful starting points for power users, but some may lag behind module or Windows changes, so review them before use and run them with administrator privileges when required.

## Included scripts

| Script | Description |
| --- | --- |
| [silent-install.ps1](silent-install.ps1) | Downloads the latest signed Virtual Display Driver release and installs it silently with NefCon. |
| [modules_install.bat](modules_install.bat) | Opens an elevated PowerShell session and installs the DisplayConfig and MonitorConfig modules used by the helper scripts. |
| [set-dependencies.ps1](set-dependencies.ps1) | Verifies the required module versions, installs or imports them when needed, and stops if prerequisites are missing. |
| [get_disp_num.ps1](get_disp_num.ps1) | Returns the numeric adapter ID of the VDD display by scanning WMI for the `MTT1337` monitor identifier. |
| [changeres-VDD.ps1](changeres-VDD.ps1) | Changes the virtual panel resolution to the width and height you provide. |
| [refreshrate-VDD.ps1](refreshrate-VDD.ps1) | Changes the VDD monitor refresh rate after validating the requested value against a safe list. |
| [rotate-VDD.ps1](rotate-VDD.ps1) | Rotates the virtual display 90, 180, or 270 degrees. |
| [scale-VDD.ps1](scale-VDD.ps1) | Sets or resets DPI scaling on the virtual monitor within Windows limits. |
| [HDRswitch-VDD.ps1](HDRswitch-VDD.ps1) | Toggles the virtual display between SDR and HDR modes. |
| [primary-VDD.ps1](primary-VDD.ps1) | Makes the virtual display the Windows primary display. |
| [toggle-VDD.ps1](toggle-VDD.ps1) | Enables or disables the Virtual Display Driver and flips Windows between Extend and Clone modes. |
| [virtual-driver-manager.ps1](virtual-driver-manager.ps1) | Installs, uninstalls, enables, disables, toggles, and inspects the Virtual Display Driver from one script. |
| [winp-VDD.ps1](winp-VDD.ps1) | Switches Windows between Extend and Clone modes without changing the driver state. |
