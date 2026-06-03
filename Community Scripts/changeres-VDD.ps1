param(
    [Parameter(Mandatory, Position=0)]
    [Alias("X","HorizontalResolution")]
    [int]$xres,
    [Parameter(Mandatory, Position=1)]
    [Alias("Y","VerticalResolution")]
    [int]$yres,
    [Parameter(Mandatory, Position=2)]
    [Alias("id","displayIndex")]
    [int]$displayId
)

# Self-elevate the script if required
if (-Not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] 'Administrator')) {
    if ([int](Get-CimInstance -Class Win32_OperatingSystem | Select-Object -ExpandProperty BuildNumber) -ge 6000) {
        $CommandLine = "-File `"" + $MyInvocation.MyCommand.Path + "`" "
        $MyInvocation.BoundParameters.GetEnumerator() | ForEach-Object { $CommandLine += "-$($_.Key):$($_.Value) " }
        Start-Process -WorkingDirectory $PSScriptRoot -FilePath PowerShell.exe -Verb Runas -ArgumentList $CommandLine  
        exit
    }
}

# Install dependencies if required
. "$PSScriptRoot\set-dependencies.ps1"

# Getting the correct display
#$disp = Get-DisplayInfo | Where-Object { $_.DisplayName -eq "VDD by MTT" }

# Setting the resolution on the display
Set-DisplayResolution -DisplayId $displayId -Width $xres -Height $yres