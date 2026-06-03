<#
.SYNOPSIS
A comprehensive script to manage the Virtual Display Driver.
It can enable, disable, toggle, and check the status of the driver.

.DESCRIPTION
This script handles the full lifecycle of the Virtual Display Driver.
- If no action is specified, it interactively prompts the user to select one.
- For enable/disable/toggle/status, it uses fast, built-in PowerShell commands.
- It requires Administrator privileges and will self-elevate if needed by re-launching in a new window.
- All temporary files are automatically cleaned up unless in Verbose mode for diagnostics.

.PARAMETER Action
Specifies the operation to perform. If omitted, the script will prompt for a selection.


.PARAMETER Json
If present, all output will be in JSON format for easy parsing by other programs.

.PARAMETER Silent
If present, the script will close automatically without prompting for a key press. By default, the script will pause for review before closing.

.PARAMETER Verbose
If present, prints detailed diagnostic information and prevents the temporary folder from being deleted for inspection. Provided by [CmdletBinding()].

.EXAMPLE
# --- USAGE WITHIN A POWERSHELL CONSOLE ---

# Run without an action to get an interactive menu. The window will pause when finished.
.\virtual-driver-manager.ps1

.EXAMPLE
# --- USAGE FROM CMD.EXE OR ANOTHER PROCESS ---

# Check driver status and get JSON output for automation (no pause).
powershell.exe -ExecutionPolicy Bypass -File .\virtual-driver-manager.ps1 -Action status -Json

# Enable the driver and have the window close automatically.
powershell.exe -ExecutionPolicy Bypass -File .\virtual-driver-manager.ps1 -Action enable -Silent
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet('enable', 'disable', 'toggle', 'status')]
    [string]$Action,

    [Parameter(Mandatory = $false)]
    [string]$DriverVersion = "latest",

    [Parameter(Mandatory = $false)]
    [switch]$Json,

    [Parameter(Mandatory = $false)]
    [switch]$Silent
)

#----------------------------------------------------------------------
# SECTION 1: CENTRALIZED LOGGING FUNCTION
#----------------------------------------------------------------------
# This helper function centralizes all script output.
# It supports both colorful console output for humans and JSON for automation.
function Write-Log {
    param(
        [string]$Message,
        [string]$Status = 'Info',
        [string]$Color = 'Cyan'
    )

    if ($Json.IsPresent) {
        $logObject = [PSCustomObject]@{
            status  = $Status.ToLower()
            message = $Message
        }
        $logObject | ConvertTo-Json -Compress | Write-Output
    }
    else {
        switch ($Status) {
            'Success' { Write-Host $Message -ForegroundColor Green }
            'Warning' { Write-Warning $Message }
            'Error'   { Write-Error $Message }
            default   { Write-Host $Message -ForegroundColor $Color }
        }
    }
}

#----------------------------------------------------------------------
# SECTION 2: INTERACTIVE ACTION PROMPT (IF NEEDED)
#----------------------------------------------------------------------
# If no action is specified, prompt the user to select one.
# This must happen before the self-elevation check so the chosen action is passed to the elevated process.
if (-not $PSBoundParameters.ContainsKey('Action')) {
    # Prompts are not suitable for automation or non-interactive shells.
    if ($Json.IsPresent -or ($host.UI.RawUI -eq $null)) {
        Write-Log -Message "The -Action parameter is mandatory for non-interactive or JSON mode execution." -Status 'Error'
        exit 1
    }

    $options = 'enable', 'disable', 'toggle', 'status'
    Write-Host "`nPlease select an action to perform:" -ForegroundColor Yellow

    for ($i = 0; $i -lt $options.Length; $i++) {
        Write-Host ("  [{0}] {1}" -f ($i + 1), (Get-Culture).TextInfo.ToTitleCase($options[$i]))
    }

    [int]$choice = 0
    while ($choice -lt 1 -or $choice -gt $options.Length) {
        $input = Read-Host -Prompt "`nEnter the number for your choice"
        if (-not ([int]::TryParse($input, [ref]$choice))) {
            $choice = 0 # Invalidate if input is not a number
        }
    }
    # Set the action from the user's choice and add it to PSBoundParameters.
    # This is critical to ensure the self-elevation logic works correctly.
    $Action = $options[$choice - 1]
    $PSBoundParameters.Add('Action', $Action) | Out-Null
    Write-Verbose "User selected action: '$Action'"
    Write-Host "" # Add a newline for better formatting
}


#----------------------------------------------------------------------
# SECTION 3: SELF-ELEVATE TO ADMINISTRATOR
#----------------------------------------------------------------------
# Check if the current user has Administrator rights.
if (-Not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]'Administrator')) {
    Write-Log -Message "Administrator rights are required. Requesting elevation..." -Status 'Warning'

    # The script must re-launch itself as an Administrator to function.
    # We must rebuild the argument list to pass all original parameters to the new elevated process.
    $psArgs = @("-ExecutionPolicy", "Bypass", "-NoProfile", "-File", "`"$($MyInvocation.MyCommand.Path)`"")

    foreach ($key in $PSBoundParameters.Keys) {
        $psArgs += "-$key"
        # Parameters with values (e.g., -Action 'install') need their value added.
        # Switch parameters (e.g., -Json, -Verbose, -Silent) do not have a value.
        if (-not ($PSBoundParameters[$key] -is [System.Management.Automation.SwitchParameter])) {
            $psArgs += $PSBoundParameters[$key]
        }
    }

    Write-Verbose "Re-launching with arguments: $($psArgs -join ' ')"

    # Start the new process with the 'Runas' verb to trigger the UAC elevation prompt.
    $elevatedProcess = Start-Process "powershell.exe" -ArgumentList $psArgs -Verb Runas -Wait -PassThru

    # Pass the exit code from the elevated process back to the original caller.
    $ActionTitleCase = (Get-Culture).TextInfo.ToTitleCase($Action)
    if ($elevatedProcess.ExitCode -eq 0) { Write-Log -Message "$ActionTitleCase Succeeded." -Status 'Success' }
    else { Write-Log -Message "$ActionTitleCase Failed. See the elevated window for details." -Status 'Error' }
    exit $elevatedProcess.ExitCode
}

#----------------------------------------------------------------------
# SECTION 4: SETUP AND GUARANTEED CLEANUP
#----------------------------------------------------------------------

# Use a try/catch/finally block to ensure that no matter what happens (success or error),
# the 'finally' block will ALWAYS run to clean up temporary files.
try {
    Write-Verbose "Script running with Administrator privileges."
    Write-Verbose "Parameters: -Action $Action -DriverVersion $DriverVersion -Json:$($Json.IsPresent) -Silent:$($Silent.IsPresent)"

    # Technical Choice: Force PowerShell to use modern TLS 1.2 for all web requests.
    # This is critical for communicating with modern secure sites like GitHub.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-Verbose "Set security protocol to TLS 1.2 for all web requests."

    #----------------------------------------------------------------------
    # SECTION 5: HELPER FUNCTION TO FIND THE DEVICE
    #----------------------------------------------------------------------
    function Get-VirtualDisplayDevice {
        # Find the device by its user-friendly name first for readability.
        $device = Get-PnpDevice -Class Display -ErrorAction Silentlycontinue | Where-Object {
            $_.FriendlyName -in ('IddSampleDriver Device HDR', 'Virtual Display Driver')
        }
        # Fallback: If not found by name, use the more specific and stable Hardware ID.
        if (-not $device) {
            $device = Get-PnpDevice -HardwareID "Root\MttVDD" -ErrorAction Silentlycontinue
        }
        return $device
    }

    #----------------------------------------------------------------------
    # SECTION 6: MAIN ACTION LOGIC
    #----------------------------------------------------------------------
    if ($Action -in @('enable', 'disable', 'toggle')) {
        $device = Get-VirtualDisplayDevice
        if (-not $device) { Write-Log -Message "Device not found. Cannot perform '$Action'. Please install the driver first." -Status 'Warning' }
        elseif ($Action -eq 'enable') { Write-Log -Message "Enabling device: $($device.FriendlyName)..."; $device | Enable-PnpDevice -Confirm:$false }
        elseif ($Action -eq 'disable') { Write-Log -Message "Disabling device: $($device.FriendlyName)..."; $device | Disable-PnpDevice -Confirm:$false }
        elseif ($Action -eq 'toggle') {
            if ($device.Status -in ('OK', 'Degraded', 'Started')) {
                Write-Log -Message "Device is currently enabled. Disabling..."; $device | Disable-PnpDevice -Confirm:$false
            }
            else { Write-Log -Message "Device is currently disabled or in an error state. Enabling..."; $device | Enable-PnpDevice -Confirm:$false }
        }
    }
    elseif ($Action -eq 'status') {
        Write-Log -Message "Checking driver status..."
        $device = Get-VirtualDisplayDevice

        $statusResult = [ordered]@{
            installed = $false
            status = "not installed"
        }

        if ($device) {
            $isEnabled = ($device.Status -in ('OK', 'Degraded', 'Started'))
            $statusText = if ($isEnabled) { "Enabled" } else { "Disabled" }
            
            $statusResult.installed = $true
            $statusResult.status = $statusText.ToLower()
            $statusResult.details = @{
                friendlyName = $device.FriendlyName
                instanceId   = $device.InstanceId
                pnpDeviceID  = $device.PNPDeviceID
            }
            $message = "Driver is installed. Status: $statusText."
        }
        else {
            $message = "Driver is not installed."
        }

        if ($Json.IsPresent) {
            # For 'status', the JSON object is the primary output, bypassing the standard log format.
            $statusResult | ConvertTo-Json -Compress | Write-Output
        }
        else {
            Write-Log -Message $message
        }
    }

    Write-Log -Message "Operation '$Action' completed successfully." -Status 'Success'
}
catch {
    # The 'catch' block will execute if any command in the 'try' block throws an error.
    $errorMessage = "An error occurred during the '$Action' operation: $($_.Exception.Message) `nAt line: $($_.InvocationInfo.ScriptLineNumber)"
    Write-Log -Message $errorMessage -Status 'Error'
    exit 1
}
finally {
    # This block ALWAYS runs, ensuring cleanup happens after success or failure.
    # If the user ran with -Verbose, we assume they are debugging.
    # We will NOT delete the temporary folder so they can inspect its contents.
    
}

# Add a final pause unless in Silent or JSON mode so the user can see the output.
if (-not $Silent.IsPresent -and -not $Json.IsPresent) {
    Write-Host ""; Write-Host "Press any key to exit..." -ForegroundColor Gray
    [System.Console]::ReadKey($true) | Out-Null
}
