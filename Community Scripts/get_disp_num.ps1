# One-liner to get the logicalname of the first VDD
# You can alter the script -First 3, would make the third in the list, 
# or -Last 2 would give second from last.

$dispnum = (Get-Monitor | Where-Object { $_.InstanceName -like '*MTT1337*' } | Sort-Object { [int] (($_.InstanceName -match 'UID(\d+)') -and $Matches[1]) } | Select-Object -First 1).LogicalDisplay.DeviceName

# Echo the result to console
Write-Host $dispnum

# Pause the console from closeing when executed from VDC
Write-Host "Press any key to continue ..."
$host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") | Out-Null
