#Scripts

This is a collection of Powershell scripts, written during the whole driver development. PR's are welcome for improvements or other/more functions. There haven't been a focus on keeping the scripts "up to date" all the time. Which means changes that might have occurred in the modules that these scripts depend upon, haven't been corrected either. These are more ment as a framework for "tinkers" to make use of Powershell to change settings on the fly. To use these, you should be at least be comfortable with Powershell and understand Admin privilegiets, risk/reward.

Anyway here is a short description of each script:

silent‑install.ps1 – Silently fetches the latest signed Virtual Display Driver from GitHub and installs it via DevCon, then tidies up the temp workspace.
modules_install.bat – Opens an elevated PowerShell session that installs the DisplayConfig and MonitorConfig modules so every helper script has its prerequisites.
set‑dependencies.ps1 – Verifies the exact module versions required, installs or imports them on demand, and aborts downstream execution if anything is missing.
get_disp_num.ps1 – Returns the numeric adapter ID of the VDD screen by scanning WMI for your custom “MTT1337” monitor identifier.
changeres‑VDD.ps1 – Hot‑swaps the virtual panel’s resolution to the width and height you pass on the command line.
refreshrate‑VDD.ps1 – Changes the VDD monitor’s refresh rate (30‑‑500 Hz) after validating the value against a safe list.
rotate‑VDD.ps1 – Rotates the virtual display 90°, 180°, or 270° by calling DisplayConfig with the matching rotation token.
scale‑VDD.ps1 – Sets or resets DPI scaling on the virtual monitor, respecting Windows’ maximum allowed scale factor.
HDRswitch‑VDD.ps1 – Flips the virtual screen between SDR (8‑bit) and HDR (10‑bit) colour modes in one click. Unsure if it works anylonger, since changes in moduels)
primary‑VDD.ps1 – Makes the virtual display the Windows primary so you can stream or remote‑desktop from a headless rig.
toggle‑VDD.ps1 – A one‑click PowerShell switch that first elevates itself to admin, then enables or disables your Virtual Display Driver and immediately flips Windows between Extended and Cloned desktops, perfect for streamers who need to bring a virtual monitor online or offline on demand.
winp‑VDD.ps1 – A lightweight companion script that leaves the driver untouched and simply yo‑yos Windows between Extend and Clone modes, giving you an instant “presentation toggle” when the virtual display should stay permanently enabled.
