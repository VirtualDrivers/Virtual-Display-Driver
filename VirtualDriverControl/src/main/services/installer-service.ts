import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { app } from 'electron'
import { createWriteStream, promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { InstallProgress, LifecycleResult, ManagedDeviceState, ManagedDriverId, ReleaseInfo } from '@shared/types'

const execFileAsync = promisify(execFile)

const ALLOWED_DOWNLOAD_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])

/**
 * Pinned nefcon release (Nefarius device console). This is the tool the
 * official Virtual Display Driver setup uses for device-node creation and
 * driver installation. Downloaded on demand and verified against the SHA-256
 * digest GitHub publishes for the release asset.
 */
const NEFCON = {
  tag: 'v1.17.40',
  url: 'https://github.com/nefarius/nefcon/releases/download/v1.17.40/nefcon_v1.17.40.zip',
  sha256: '812bae7ed7dfb7d6d2284bc7de2f8ccebc92ed2a0b1ae893c53b337096e50c1a'
}

interface DriverSpec {
  title: string
  repo: string
  pickAsset: (names: string[]) => string | undefined
  infName: string
  /** File whose Authenticode signature gets trusted before install. */
  signedBinary: string
  hardwareId: string
  /**
   * PowerShell regex matched against Get-PnpDevice .HardwareID. Instance IDs
   * vary by how the node was created (nefcon yields ROOT\DISPLAY\000x), so
   * the hardware ID is the only reliable way to find our devices.
   */
  hardwareIdPattern: string
  /** Setup class name + GUID (brace-free, as nefcon expects). */
  className: string
  classGuid: string
  deviceDescription: string
  /** Copy the package contents to the configured base dir (display driver keeps its settings there). */
  copyToBaseDir: boolean
  /** Files never overwritten during the copy. */
  preserveFiles: string[]
  maxInstances: number
}

const DRIVERS: Record<ManagedDriverId, DriverSpec> = {
  display: {
    title: 'Virtual Display Driver',
    repo: 'VirtualDrivers/Virtual-Display-Driver',
    pickAsset: (names) => {
      const wantArm = os.arch() === 'arm64'
      return names.find((n) =>
        wantArm ? /VirtualDisplayDriver-ARM64\.Driver\.Only\.zip/i.test(n) : /VirtualDisplayDriver-x(86|64)\.Driver\.Only\.zip/i.test(n)
      )
    },
    infName: 'MttVDD.inf',
    signedBinary: 'MttVDD.dll',
    hardwareId: 'Root\\MttVDD',
    hardwareIdPattern: '^Root\\\\MttVDD$',
    className: 'Display',
    classGuid: '4D36E968-E325-11CE-BFC1-08002BE10318',
    deviceDescription: 'Virtual Display Driver',
    copyToBaseDir: true,
    preserveFiles: ['vdd_settings.xml'],
    maxInstances: 1
  },
  audio: {
    title: 'Virtual Audio Driver',
    repo: 'VirtualDrivers/Virtual-Audio-Driver',
    pickAsset: (names) => names.find((n) => /\.zip$/i.test(n)),
    infName: 'VirtualAudioDriver.inf',
    signedBinary: 'VirtualAudioDriver.sys',
    hardwareId: 'Root\\VirtualAudioDriver',
    hardwareIdPattern: '^Root\\\\VirtualAudioDriver$',
    className: 'MEDIA',
    classGuid: '4D36E96C-E325-11CE-BFC1-08002BE10318',
    deviceDescription: 'Virtual Audio Driver',
    copyToBaseDir: false,
    preserveFiles: [],
    maxInstances: 4
  }
}

interface GithubAsset {
  name: string
  size: number
  browser_download_url: string
  digest?: string
}

interface GithubRelease {
  tag_name: string
  name: string
  published_at: string
  body: string
  html_url: string
  assets: GithubAsset[]
}

/**
 * Downloads the latest signed driver packages from the official VirtualDrivers
 * releases and manages the device lifecycle (install / uninstall / restart /
 * instance count) through elevated PowerShell. Device-node creation and driver
 * installation go through nefcon - the same tool the official VDD setup uses -
 * which is fetched on demand from its pinned GitHub release and SHA-256
 * verified. pnputil remains in use for restarts and driver-store cleanup.
 */
export class InstallerService {
  private busy = false

  constructor(
    private readonly getBaseDir: () => string,
    private readonly isAdmin: () => Promise<boolean>,
    private readonly emitProgress: (progress: InstallProgress) => void
  ) {}

  // -------------------------------------------------------------------------
  // Release discovery / state
  // -------------------------------------------------------------------------

  async latestRelease(driver: ManagedDriverId): Promise<ReleaseInfo> {
    const spec = DRIVERS[driver]
    const response = await fetch(`https://api.github.com/repos/${spec.repo}/releases/latest`, {
      headers: { 'User-Agent': 'Virtual-Driver-Control', Accept: 'application/vnd.github+json' }
    })
    if (!response.ok) throw new Error(`GitHub API responded ${response.status}`)
    const release = (await response.json()) as GithubRelease

    const assetName = spec.pickAsset(release.assets.map((a) => a.name))
    const asset = release.assets.find((a) => a.name === assetName)

    return {
      tag: release.tag_name,
      name: release.name,
      publishedAt: release.published_at,
      notes: release.body ?? '',
      htmlUrl: release.html_url,
      asset: asset
        ? {
            name: asset.name,
            sizeBytes: asset.size,
            downloadUrl: asset.browser_download_url,
            sha256: asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined
          }
        : null
    }
  }

  async installedReleaseTag(driver: ManagedDriverId): Promise<string | null> {
    const read = async (path: string): Promise<string | null> => {
      try {
        const marker = JSON.parse(await fs.readFile(path, 'utf8')) as { tag?: string }
        return marker.tag ?? null
      } catch {
        return null
      }
    }
    const tag = await read(this.markerPath(driver))
    if (tag) return tag
    // Legacy location used by the first installer iteration (display only).
    if (driver === 'display') return read(join(this.getBaseDir(), 'installed_release.json'))
    return null
  }

  /** Non-elevated device presence/status query. */
  async deviceState(driver: ManagedDriverId): Promise<ManagedDeviceState> {
    const spec = DRIVERS[driver]
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -match '${spec.hardwareIdPattern}' } | ForEach-Object { $_.Status } | ConvertTo-Json -Compress`
        ],
        { windowsHide: true, timeout: 20_000 }
      )
      const trimmed = stdout.trim()
      if (!trimmed) return { count: 0, statuses: [] }
      const parsed = JSON.parse(trimmed) as string | string[]
      const statuses = Array.isArray(parsed) ? parsed : [parsed]
      return { count: statuses.length, statuses }
    } catch {
      return { count: 0, statuses: [] }
    }
  }

  /**
   * Whether the boot configuration has test signing enabled. The Virtual
   * Audio Driver is currently only test-signed, so its device will not start
   * without it. Returns null when the state cannot be determined (bcdedit
   * needs administrator rights).
   */
  async testSigningEnabled(): Promise<boolean | null> {
    try {
      const { stdout } = await execFileAsync('bcdedit', ['/enum', '{current}'], { windowsHide: true, timeout: 15_000 })
      return /testsigning\s+Yes/i.test(stdout)
    } catch {
      return null
    }
  }

  /** Toggles Windows test signing via bcdedit (takes effect after a restart). */
  async setTestSigning(enabled: boolean): Promise<LifecycleResult> {
    return this.exclusive(async () => {
      this.emitProgress({
        phase: 'install',
        percent: -1,
        message: `${enabled ? 'Enabling' : 'Disabling'} Windows test signing (this may prompt for elevation)…`
      })
      return this.runElevated(`
Write-Output "== Windows test signing: ${enabled ? 'enable' : 'disable'} =="
$out = bcdedit /set "{current}" testsigning ${enabled ? 'on' : 'off'} 2>&1 | Out-String
Write-Output $out.Trim()
if ($LASTEXITCODE -ne 0) {
  if ($out -match 'Secure Boot') {
    Write-Output "RESULT: blocked by Secure Boot - disable Secure Boot in the UEFI firmware settings first"
  } else {
    Write-Output "RESULT: bcdedit failed with exit code $LASTEXITCODE"
  }
  $script:failed = $true
} else {
  Write-Output "RESULT: test signing ${enabled ? 'enabled' : 'disabled'} - restart Windows for the change to take effect"
}
`)
    })
  }

  // -------------------------------------------------------------------------
  // Lifecycle operations
  // -------------------------------------------------------------------------

  async downloadAndInstall(driver: ManagedDriverId, instances = 1): Promise<LifecycleResult> {
    const spec = DRIVERS[driver]
    const target = clampInstances(instances, spec)
    return this.exclusive(async () => {
      const release = await this.latestRelease(driver)
      if (!release.asset) return { ok: false, error: `Release ${release.tag} has no driver package for ${os.arch()}` }

      const url = new URL(release.asset.downloadUrl)
      if (url.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) {
        return { ok: false, error: `Refusing download from unexpected host: ${url.hostname}` }
      }

      // 1. Download with progress.
      const workDir = join(app.getPath('temp'), `vdd-install-${driver}-${Date.now()}`)
      await fs.mkdir(workDir, { recursive: true })
      const zipPath = join(workDir, release.asset.name)
      await this.downloadFile(release.asset.downloadUrl, zipPath, release.asset.sizeBytes)

      // 2. Verify checksum against the digest GitHub publishes for the asset.
      this.emitProgress({ phase: 'verify', percent: -1, message: 'Verifying package integrity…' })
      if (release.asset.sha256) {
        const actual = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex')
        if (actual.toLowerCase() !== release.asset.sha256.toLowerCase()) {
          return { ok: false, error: `Checksum mismatch - expected ${release.asset.sha256}, got ${actual}` }
        }
      }

      // 3. Extract.
      this.emitProgress({ phase: 'extract', percent: -1, message: 'Extracting driver package…' })
      const extractDir = join(workDir, 'extracted')
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${extractDir}'`],
        { windowsHide: true, timeout: 60_000 }
      )
      const infPath = await this.findFile(extractDir, new RegExp(`^${spec.infName.replace('.', '\\.')}$`, 'i'))
      if (!infPath) return { ok: false, error: `Driver package did not contain ${spec.infName}` }
      const packageDir = infPath.slice(0, infPath.lastIndexOf('\\'))

      // 4. Make sure the nefcon install tool is available.
      const nefcon = await this.ensureNefcon()

      // 5. Elevated install.
      this.emitProgress({ phase: 'install', percent: -1, message: `Installing ${spec.title} (this may prompt for elevation)…` })
      const result = await this.runElevated(this.buildInstallScript(driver, packageDir, target, nefcon))
      if (!result.ok) return result

      // 6. Record what we installed.
      this.emitProgress({ phase: 'finalize', percent: -1, message: 'Finishing up…' })
      try {
        await fs.writeFile(
          this.markerPath(driver),
          JSON.stringify({ tag: release.tag, asset: release.asset.name, installedAt: new Date().toISOString() }, null, 2),
          'utf8'
        )
      } catch {
        // marker is best-effort
      }
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
      return result
    })
  }

  async uninstall(driver: ManagedDriverId): Promise<LifecycleResult> {
    return this.exclusive(async () => {
      const nefcon = await this.ensureNefcon()
      this.emitProgress({ phase: 'install', percent: -1, message: `Removing ${DRIVERS[driver].title} (this may prompt for elevation)…` })
      const result = await this.runElevated(this.buildUninstallScript(driver, nefcon))
      if (result.ok) await fs.rm(this.markerPath(driver), { force: true }).catch(() => undefined)
      return result
    })
  }

  async restartDevice(driver: ManagedDriverId): Promise<LifecycleResult> {
    return this.exclusive(async () => {
      this.emitProgress({ phase: 'install', percent: -1, message: 'Restarting device (this may prompt for elevation)…' })
      return this.runElevated(this.buildRestartScript(driver))
    })
  }

  /** Create or remove device nodes so exactly `count` instances exist (audio driver). */
  async setInstances(driver: ManagedDriverId, count: number): Promise<LifecycleResult> {
    const spec = DRIVERS[driver]
    if (spec.maxInstances < 2) return { ok: false, error: `${spec.title} does not support multiple instances` }
    const target = clampInstances(count, spec)
    return this.exclusive(async () => {
      const nefcon = await this.ensureNefcon()
      this.emitProgress({ phase: 'install', percent: -1, message: `Setting ${spec.title} to ${target} device${target === 1 ? '' : 's'}…` })
      return this.runElevated(this.buildSetInstancesScript(driver, target, nefcon))
    })
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private markerPath(driver: ManagedDriverId): string {
    return join(app.getPath('userData'), `installed_release_${driver}.json`)
  }

  /**
   * Ensures the pinned nefcon release is cached locally and returns the path
   * to the console binary for this CPU architecture. The console flavor
   * (nefconc) is used so its output lands in the elevated transcript; the
   * window stays hidden either way.
   */
  private async ensureNefcon(): Promise<string> {
    const archDir = os.arch() === 'arm64' ? 'ARM64' : os.arch() === 'ia32' ? 'x86' : 'x64'
    const toolDir = join(app.getPath('userData'), 'tools', `nefcon-${NEFCON.tag}`)
    const exePath = join(toolDir, archDir, 'nefconc.exe')
    if (await pathExists(exePath)) return exePath

    this.emitProgress({ phase: 'download', percent: -1, message: `Downloading nefcon ${NEFCON.tag} (device install tool)…` })
    const zipPath = join(app.getPath('temp'), `nefcon-${Date.now()}.zip`)
    try {
      await this.downloadFile(NEFCON.url, zipPath, 0)

      this.emitProgress({ phase: 'verify', percent: -1, message: 'Verifying nefcon integrity…' })
      const actual = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex')
      if (actual.toLowerCase() !== NEFCON.sha256) {
        throw new Error(`nefcon download failed checksum verification (expected ${NEFCON.sha256}, got ${actual})`)
      }

      await fs.mkdir(toolDir, { recursive: true })
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${toolDir}'`],
        { windowsHide: true, timeout: 60_000 }
      )
      if (!(await pathExists(exePath))) throw new Error('nefcon package did not contain the expected binary')
      return exePath
    } finally {
      void fs.rm(zipPath, { force: true }).catch(() => undefined)
    }
  }

  private async exclusive(operation: () => Promise<LifecycleResult>): Promise<LifecycleResult> {
    if (this.busy) return { ok: false, error: 'Another driver operation is already running' }
    this.busy = true
    try {
      return await operation()
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.busy = false
    }
  }

  private async downloadFile(url: string, destination: string, expectedSize: number): Promise<void> {
    const response = await fetch(url, { headers: { 'User-Agent': 'Virtual-Driver-Control' } })
    if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}`)

    const total = Number(response.headers.get('content-length')) || expectedSize || 0
    const out = createWriteStream(destination)
    const reader = response.body.getReader()
    let received = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (!out.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => out.once('drain', resolve))
        }
        this.emitProgress({
          phase: 'download',
          percent: total > 0 ? Math.round((received / total) * 100) : -1,
          message: `Downloading ${(received / 1024).toFixed(0)} KB${total > 0 ? ` of ${(total / 1024).toFixed(0)} KB` : ''}…`
        })
      }
    } finally {
      await new Promise<void>((resolve) => out.end(resolve))
    }
  }

  private async findFile(root: string, pattern: RegExp): Promise<string | null> {
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(root, entry.name)
      if (entry.isFile() && pattern.test(entry.name)) return full
      if (entry.isDirectory()) {
        const nested = await this.findFile(full, pattern)
        if (nested) return nested
      }
    }
    return null
  }

  /**
   * Runs a PowerShell script with admin rights. If the app is already
   * elevated it runs inline; otherwise a single UAC prompt is triggered.
   * Output is captured through a temp log file in both cases.
   */
  private async runElevated(script: string): Promise<LifecycleResult> {
    const stamp = Date.now()
    const scriptPath = join(app.getPath('temp'), `vdd-op-${stamp}.ps1`)
    const logPath = join(app.getPath('temp'), `vdd-op-${stamp}.log`)

    const wrapped = [
      `$ErrorActionPreference = 'Continue'`,
      `Start-Transcript -Path '${logPath}' -Force | Out-Null`,
      `$script:failed = $false`,
      script,
      `Stop-Transcript | Out-Null`,
      `if ($script:failed) { exit 1 } else { exit 0 }`
    ].join('\r\n')
    await fs.writeFile(scriptPath, wrapped, 'utf8')

    try {
      const elevated = await this.isAdmin()
      let exitCode: number
      if (elevated) {
        try {
          await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
            windowsHide: true,
            timeout: 300_000
          })
          exitCode = 0
        } catch (error) {
          exitCode = (error as { code?: number }).code ?? 1
        }
      } else {
        // -Verb RunAs cannot capture output directly; the transcript log covers that.
        const launcher = `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}'; exit $p.ExitCode`
        try {
          await execFileAsync('powershell.exe', ['-NoProfile', '-Command', launcher], { windowsHide: true, timeout: 300_000 })
          exitCode = 0
        } catch (error) {
          const failure = error as { code?: number; message?: string; stderr?: string }
          // UAC decline surfaces as a launcher error ("canceled by the user").
          if (/canceled|cancelled/i.test(`${failure.message ?? ''} ${failure.stderr ?? ''}`)) {
            return { ok: false, error: 'Elevation was declined - the operation was cancelled.' }
          }
          exitCode = failure.code ?? 1
        }
      }

      const log = await fs.readFile(logPath, 'utf8').catch(() => '')
      const detail = summarizeTranscript(log)
      if (exitCode === 0) return { ok: true, detail }
      return { ok: false, error: `Operation failed (exit ${exitCode})`, detail }
    } finally {
      void fs.rm(scriptPath, { force: true }).catch(() => undefined)
      void fs.rm(logPath, { force: true }).catch(() => undefined)
    }
  }

  // -------------------------------------------------------------------------
  // Elevated script builders
  // -------------------------------------------------------------------------

  private buildInstallScript(driver: ManagedDriverId, packageDir: string, instances: number, nefconPath: string): string {
    const spec = DRIVERS[driver]
    const copyBlock = spec.copyToBaseDir
      ? `
# --- Copy package to the driver folder (never overwrite user settings) ---
$base = '${this.getBaseDir()}'
New-Item -ItemType Directory -Force -Path $base | Out-Null
$preserve = @(${spec.preserveFiles.map((f) => `'${f}'`).join(',')})
foreach ($f in Get-ChildItem -File $pkg) {
  if (($preserve -contains $f.Name) -and (Test-Path (Join-Path $base $f.Name))) {
    Write-Output ("Keeping existing " + $f.Name)
    continue
  }
  Copy-Item -Force $f.FullName (Join-Path $base $f.Name)
}

# --- Point the driver's settings lookup (VDDPATH) at this folder ---
New-Item -Path 'HKLM:\\SOFTWARE\\MikeTheTech\\VirtualDisplayDriver' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\MikeTheTech\\VirtualDisplayDriver' -Name 'VDDPATH' -Value $base -Force
Write-Output "VDDPATH registry value set to $base"
`
      : ''

    // Single-instance drivers also clean up stray duplicate nodes from earlier
    // failed installs; multi-instance drivers must keep their duplicates.
    const installFlags = spec.maxInstances === 1 ? '--no-duplicates --remove-duplicates' : '--no-duplicates'

    return `
$pkg = '${packageDir}'
$inf = Join-Path $pkg '${spec.infName}'
$bin = Join-Path $pkg '${spec.signedBinary}'
$nefcon = '${nefconPath}'
$target = ${instances}

Write-Output "== ${spec.title} install =="
${copyBlock}
# --- Trust the package signer so the driver installs silently ---
$sig = Get-AuthenticodeSignature $bin
if ($sig.SignerCertificate) {
  Write-Output ("Trusting signer: " + $sig.SignerCertificate.Subject)
  foreach ($storeName in @('TrustedPublisher','Root')) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, 'LocalMachine')
    $store.Open('ReadWrite')
    $store.Add($sig.SignerCertificate)
    $store.Close()
  }
} else {
  Write-Output "WARNING: package is unsigned"
}

# --- Create the device node and install the driver via nefcon ---
Write-Output "Installing driver via nefcon (devcon-compatible install)"
& $nefcon install "$inf" '${spec.hardwareId}' ${installFlags} 2>&1 | ForEach-Object { Write-Output $_ }
$rc = $LASTEXITCODE
if ($rc -eq 3010) {
  Write-Output "NOTE: Windows reports a reboot is required to finish the install"
} elseif ($rc -ne 0) {
  Write-Output "nefcon install failed with exit code $rc"
  $script:failed = $true
}

# --- Create any additional device nodes up to the target count ---
$existing = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -match '${spec.hardwareIdPattern}' })
Write-Output ("Existing device nodes: " + $existing.Count + ", target: " + $target)
$toCreate = $target - $existing.Count
if (-not $script:failed -and $toCreate -gt 0) {
  for ($i = 0; $i -lt $toCreate; $i++) {
    & $nefcon --create-device-node --hardware-id '${spec.hardwareId}' --class-name '${spec.className}' --class-guid '${spec.classGuid}' 2>&1 | ForEach-Object { Write-Output $_ }
    if ($LASTEXITCODE -ne 0) {
      Write-Output "Device node creation failed with exit code $LASTEXITCODE"
      $script:failed = $true
      break
    }
    Write-Output ("Device node " + ($existing.Count + $i + 1) + " created")
  }
  # Bind the staged driver to the freshly created nodes.
  & $nefcon --install-driver --inf-path "$inf" 2>&1 | ForEach-Object { Write-Output $_ }
}

# --- Verify ---
Start-Sleep -Seconds 2
$dev = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -match '${spec.hardwareIdPattern}' })
if ($dev.Count -gt 0) {
  Write-Output ("RESULT: " + $dev.Count + " device(s) present, status " + (($dev | ForEach-Object { $_.Status }) -join ', '))
} else {
  Write-Output "RESULT: device not found after install"
  $script:failed = $true
}
`
  }

  private buildUninstallScript(driver: ManagedDriverId, nefconPath: string): string {
    const spec = DRIVERS[driver]
    return `
$nefcon = '${nefconPath}'
Write-Output "== ${spec.title} uninstall =="

# --- Remove the device node(s) and driver via nefcon ---
$devices = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -match '${spec.hardwareIdPattern}' })
if ($devices.Count -gt 0) {
  Write-Output ("Removing " + $devices.Count + " device node(s) via nefcon")
  & $nefcon --remove-device-node --hardware-id '${spec.hardwareId}' --class-guid '${spec.classGuid}' 2>&1 | ForEach-Object { Write-Output $_ }
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) {
    Write-Output "nefcon remove-device-node failed with exit code $LASTEXITCODE"
    $script:failed = $true
  }
} else {
  Write-Output "No ${spec.title} device present"
}

# --- Sweep any leftover staged package(s) out of the driver store ---
$enum = pnputil /enum-drivers | Out-String
$blocks = $enum -split '(?=Published Name)'
foreach ($b in $blocks) {
  if ($b -match '${spec.infName.replace('.', '\\.')}') {
    if ($b -match 'Published Name\\s*:\\s*(oem\\d+\\.inf)') {
      $oem = $Matches[1]
      Write-Output "Deleting driver package $oem"
      pnputil /delete-driver $oem /uninstall /force 2>&1 | ForEach-Object { Write-Output $_ }
    }
  }
}

Write-Output "RESULT: uninstall complete (configuration files were kept)"
`
  }

  private buildRestartScript(driver: ManagedDriverId): string {
    const spec = DRIVERS[driver]
    return `
Write-Output "== ${spec.title} device restart =="
$devices = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -match '${spec.hardwareIdPattern}' }
if (-not $devices) {
  Write-Output "RESULT: no device found"
  $script:failed = $true
} else {
  foreach ($d in $devices) {
    Write-Output ("Restarting " + $d.InstanceId)
    pnputil /disable-device $d.InstanceId 2>&1 | ForEach-Object { Write-Output $_ }
    Start-Sleep -Seconds 2
    pnputil /enable-device $d.InstanceId 2>&1 | ForEach-Object { Write-Output $_ }
  }
  Start-Sleep -Seconds 2
  $after = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -match '${spec.hardwareIdPattern}' -and $_.Status -eq 'OK' }
  if ($after) { Write-Output "RESULT: device restarted, status OK" }
  else { Write-Output "RESULT: device did not come back healthy"; $script:failed = $true }
}
`
  }

  private buildSetInstancesScript(driver: ManagedDriverId, target: number, nefconPath: string): string {
    const spec = DRIVERS[driver]
    return `
$nefcon = '${nefconPath}'
$target = ${target}
Write-Output "== ${spec.title}: set instance count to $target =="

# --- Locate the staged INF (needed to bind newly created devices) ---
$oem = $null
$enum = pnputil /enum-drivers | Out-String
$blocks = $enum -split '(?=Published Name)'
foreach ($b in $blocks) {
  if ($b -match '${spec.infName.replace('.', '\\.')}' -and $b -match 'Published Name\\s*:\\s*(oem\\d+\\.inf)') {
    $oem = $Matches[1]
  }
}
if (-not $oem) {
  Write-Output "RESULT: driver is not installed - install it first"
  $script:failed = $true
} else {
  $infPath = Join-Path $env:windir ('INF\\' + $oem)
  Write-Output "Using staged driver $oem"

  $existing = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -match '${spec.hardwareIdPattern}' } | Sort-Object InstanceId)
  Write-Output ("Existing device nodes: " + $existing.Count)

  if ($existing.Count -lt $target) {
    for ($i = $existing.Count; $i -lt $target; $i++) {
      & $nefcon --create-device-node --hardware-id '${spec.hardwareId}' --class-name '${spec.className}' --class-guid '${spec.classGuid}' 2>&1 | ForEach-Object { Write-Output $_ }
      if ($LASTEXITCODE -ne 0) {
        Write-Output "Device node creation failed with exit code $LASTEXITCODE"
        $script:failed = $true
        break
      }
      Write-Output ("Device node " + ($i + 1) + " created")
    }
    # Bind the staged driver to the freshly created nodes.
    & $nefcon --install-driver --inf-path "$infPath" 2>&1 | ForEach-Object { Write-Output $_ }
  } elseif ($existing.Count -gt $target) {
    $toRemove = $existing | Select-Object -Last ($existing.Count - $target)
    foreach ($d in $toRemove) {
      Write-Output ("Removing device " + $d.InstanceId)
      pnputil /remove-device $d.InstanceId 2>&1 | ForEach-Object { Write-Output $_ }
    }
  } else {
    Write-Output "Already at target count"
  }

  Start-Sleep -Seconds 2
  $after = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -match '${spec.hardwareIdPattern}' })
  Write-Output ("RESULT: " + $after.Count + " device(s) present, status " + (($after | ForEach-Object { $_.Status }) -join ', '))
  if ($after.Count -ne $target) { $script:failed = $true }
}
`
  }
}

function pathExists(path: string): Promise<boolean> {
  return fs.access(path).then(
    () => true,
    () => false
  )
}

function clampInstances(value: number, spec: DriverSpec): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(Math.round(value), 1), spec.maxInstances)
}

/** Pull the useful tail out of a PowerShell transcript. */
function summarizeTranscript(log: string): string {
  const lines = log
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .filter((l) => !/^\*{10,}|^Windows PowerShell transcript|^Start time|^End time|^Username|^RunAs User|^Configuration Name|^Machine|^Host Application|^Process ID|^PSVersion|^PSEdition|^PSCompatibleVersions|^BuildVersion|^CLRVersion|^WSManStackVersion|^PSRemotingProtocolVersion|^SerializationVersion|^Transcript started|^\s*$/.test(l))
  return lines.slice(-25).join('\n')
}
