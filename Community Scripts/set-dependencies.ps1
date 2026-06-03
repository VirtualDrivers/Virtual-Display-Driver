# Define the repository name and URL
$repo = @{Name = "PSGallery"; Url = "https://www.powershellgallery.com/api/v2" }

# Define the requred modules and their required versions BEFORE using them
$modules = @(
    @{
        Name    = "DisplayConfig"
        Version = "1.1.1"
    },
    @{
        Name    = "MonitorConfig"
        Version = "1.0.3"
    }
)
Write-Output "resolving dependencies"

# Check if the repository is registered
if (-not (Get-PSRepository -Name $repo.Name -ErrorAction SilentlyContinue)) {
    Write-Host "PSRepository '$($repo.Name)' cannot be found. Make sure it is available."
    exit 1
}

# Trust the repository (this sets the installation policy to Trusted)
Set-PSRepository -Name $repo.Name -InstallationPolicy Trusted `
    -InformationAction Ignore -WarningAction SilentlyContinue

#import DisplayConfig
Import-Module DisplayConfig
#import MonitorConfig
Import-Module MonitorConfig

# Loop through the modules and ensure they are imported & installed
foreach ($m in $modules) {

    # If the module is already imported, continue to the next module
    if (Get-Module -Name $m.Name) { 
        Write-Output "$($m.Name) is imported."
        continue
    }

    # If the module is available on disk then import it
    elseif (Get-Module -ListAvailable -Name $m.Name) {
        Write-Output "$($m.Name) is installed but not imported: import."
        Import-Module $m.Name
    }
    else {
        # If the module is not on disk, check if it's available in the online gallery
        if (Find-Module -Name $m.Name -ErrorAction SilentlyContinue) {
            Write-Output "$($m.Name) is available online, but not installed or imported: install and import."
            # Install the module (specifying the required version)
            Install-Module -Name $m.Name -RequiredVersion $m.Version `
                -Force -Scope CurrentUser -AllowClobber

            # Import the module after installation
            Import-Module $m.Name
        }
        else {
            # If the module cannot be found in the online gallery, abort the script.
            Write-Output "Module '$($m.Name)' is not imported, not available on disk, and not found in the online gallery. Cannot run the script."
            exit 1
        }
    }
    # Save Module for later use
    if (-not (Get-InstalledModule -Name $m.Name -MinimumVersion $m.Version -ErrorAction SilentlyContinue)) {
        Write-Output "Saving module $($m.Name)."
        Save-Module -Name $m.Name -Repository $repo.Name -RequiredVersion $m.Version `
            -Confirm:$false -InformationAction Ignore -WarningAction SilentlyContinue
    }
}