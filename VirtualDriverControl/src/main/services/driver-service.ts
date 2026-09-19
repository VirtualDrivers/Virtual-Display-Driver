import { execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import os from 'os'
import { promisify } from 'util'
import { app } from 'electron'
import type { DriverStatus, GpuInfo, SystemInfo } from '@shared/types'
import type { PipeClient } from './pipe-client'

const execFileAsync = promisify(execFile)

const DRIVER_DLL = 'C:\\Windows\\System32\\drivers\\UMDF\\MttVDD.dll'
const DEVICE_CACHE_TTL_MS = 30_000

interface DeviceInfo {
  present: boolean
  name?: string
  pnpStatus?: string
}

async function powershell(script: string, timeoutMs = 10_000): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  )
  return stdout.trim()
}

export class DriverService {
  private deviceCache: { value: DeviceInfo; at: number } | null = null
  private adminCache: boolean | null = null

  constructor(
    private readonly pipe: PipeClient,
    private readonly paths: { getBaseDir: () => string }
  ) {}

  async status(force = false): Promise<DriverStatus> {
    const pipeConnected = await this.pipe.ping()
    const device = await this.queryDevice(force)
    const dllPresent = existsSync(DRIVER_DLL)
    let dllDate: string | undefined
    if (dllPresent) {
      try {
        dllDate = statSync(DRIVER_DLL).mtime.toISOString().slice(0, 10)
      } catch {
        // ignore
      }
    }

    let level: DriverStatus['level'] = 'unknown'
    if (pipeConnected) level = 'online'
    else if (device.present || dllPresent) level = 'installed-offline'
    else level = 'not-installed'

    return {
      level,
      pipeConnected,
      devicePresent: device.present,
      deviceName: device.name,
      devicePnpStatus: device.pnpStatus,
      dllPresent,
      dllDate,
      checkedAt: Date.now()
    }
  }

  /**
   * GPU inventory. Prefers the driver's own enumeration (GETALLGPUS +
   * GETASSIGNEDGPU); falls back to WMI when the pipe is offline.
   */
  async gpus(): Promise<GpuInfo[]> {
    const fromPipe = await this.gpusViaPipe()
    if (fromPipe.length > 0) return fromPipe
    return this.gpusViaWmi()
  }

  async assignedGpu(): Promise<string | null> {
    const result = await this.pipe.send('GETASSIGNEDGPU')
    if (!result.ok) return null
    return extractGpuNames(result.lines)[0] ?? null
  }

  /**
   * Detected IddCx framework version, e.g. "1.10".
   *
   * The driver's IDDCXVERSION command only echoes "IDDCX Version: 0x…" over
   * the pipe when file logging AND SendLogsThroughPipe are both enabled, so
   * the pipe is best-effort. The reliable fallback maps the IddCx.dll (or OS)
   * build number to the published IddCx version table.
   */
  async iddcxVersion(): Promise<string | null> {
    const result = await this.pipe.send('IDDCXVERSION')
    if (result.ok) {
      const hex = result.response.match(/IDDCX[^\n]*?(0x[0-9a-fA-F]{3,8})/i)?.[1]
      const decoded = hex ? decodeIddCxVersion(Number.parseInt(hex, 16)) : null
      if (decoded) return decoded
    }
    const build = (await this.iddcxDllBuild()) ?? osBuildNumber()
    return build !== null ? iddcxVersionForBuild(build) : null
  }

  /** Build number of the IddCx framework binary that drivers actually load. */
  private async iddcxDllBuild(): Promise<number | null> {
    try {
      const out = await powershell(`(Get-Item 'C:\\Windows\\System32\\drivers\\UMDF\\IddCx.dll').VersionInfo.FileBuildPart`)
      const build = Number.parseInt(out, 10)
      return Number.isFinite(build) ? build : null
    } catch {
      return null
    }
  }

  async isAdmin(): Promise<boolean> {
    if (this.adminCache !== null) return this.adminCache
    try {
      const out = await powershell(
        `([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`
      )
      this.adminCache = out.toLowerCase().includes('true')
    } catch {
      this.adminCache = false
    }
    return this.adminCache
  }

  async systemInfo(): Promise<SystemInfo> {
    const isAdmin = await this.isAdmin()
    return {
      windowsVersion: os.version(),
      windowsBuild: os.release(),
      arch: os.arch(),
      isAdmin,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      settingsPath: `${this.paths.getBaseDir()}\\vdd_settings.xml`,
      logsDir: `${this.paths.getBaseDir()}\\Logs`
    }
  }

  private async queryDevice(force: boolean): Promise<DeviceInfo> {
    if (!force && this.deviceCache && Date.now() - this.deviceCache.at < DEVICE_CACHE_TTL_MS) {
      return this.deviceCache.value
    }
    let value: DeviceInfo = { present: false }
    try {
      const out = await powershell(
        `Get-CimInstance Win32_PnPEntity | Where-Object { ($_.DeviceID -like '*MttVDD*') -or ($_.Name -like '*Virtual Display Driver*') } | Select-Object Name, Status | ConvertTo-Json -Compress`
      )
      if (out) {
        const parsed: unknown = JSON.parse(out)
        const first = Array.isArray(parsed) ? parsed[0] : parsed
        if (first && typeof first === 'object') {
          const rec = first as { Name?: string; Status?: string }
          value = { present: true, name: rec.Name ?? 'Virtual Display Driver', pnpStatus: rec.Status }
        }
      }
    } catch {
      // WMI unavailable or no match - treat as not present.
    }
    this.deviceCache = { value, at: Date.now() }
    return value
  }

  private async gpusViaPipe(): Promise<GpuInfo[]> {
    const all = await this.pipe.send('GETALLGPUS')
    if (!all.ok) return []
    const names = extractGpuNames(all.lines)
    if (names.length === 0) return []
    const assigned = await this.assignedGpu()
    return names.map((name) => ({
      name,
      source: 'pipe' as const,
      assigned: assigned !== null && name.toLowerCase() === assigned.toLowerCase()
    }))
  }

  private async gpusViaWmi(): Promise<GpuInfo[]> {
    try {
      const out = await powershell(
        `Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, AdapterRAM | ConvertTo-Json -Compress`
      )
      if (!out) return []
      const parsed: unknown = JSON.parse(out)
      const list = Array.isArray(parsed) ? parsed : [parsed]
      return list
        .filter((g): g is { Name?: string; DriverVersion?: string; AdapterRAM?: number } => !!g && typeof g === 'object')
        .filter((g) => typeof g.Name === 'string' && g.Name.length > 0)
        .map((g) => ({
          name: g.Name as string,
          source: 'wmi' as const,
          assigned: false,
          driverVersion: g.DriverVersion,
          vramMB: typeof g.AdapterRAM === 'number' && g.AdapterRAM > 0 ? Math.round(g.AdapterRAM / 1024 / 1024) : undefined
        }))
    } catch {
      return []
    }
  }
}

/**
 * IddCxGetVersion values are nibble-encoded per Microsoft's IddCx versions
 * table: 0x1500 → 1.5, 0x1A00/0x1A80 → 1.10, 0x1B00 → 1.11.
 */
function decodeIddCxVersion(value: number): string | null {
  if (!Number.isFinite(value) || value < 0x1000) return null
  return `${value >> 12}.${(value >> 8) & 0xf}`
}

/** Windows build → shipped IddCx version (learn.microsoft.com, iddcx-versions). */
const BUILD_TO_IDDCX: Array<[minBuild: number, version: string]> = [
  [26100, '1.10'],
  [22631, '1.10'],
  [22621, '1.9'],
  [22000, '1.8'],
  [19041, '1.5'],
  [18362, '1.4']
]

function iddcxVersionForBuild(build: number): string | null {
  for (const [minBuild, version] of BUILD_TO_IDDCX) {
    if (build >= minBuild) return version
  }
  return null
}

/** Build number from os.release(), e.g. "10.0.26200" → 26200. */
function osBuildNumber(): number | null {
  const match = os.release().match(/^\d+\.\d+\.(\d+)/)
  if (!match) return null
  const build = Number.parseInt(match[1], 10)
  return Number.isFinite(build) ? build : null
}

/**
 * The pipe responds to GPU queries with free-form log lines. Pull out
 * plausible GPU names: lines after "GPU:" markers or lines that look like
 * adapter names.
 */
function extractGpuNames(lines: string[]): string[] {
  const names: string[] = []
  for (const line of lines) {
    const marker = line.match(/GPU(?:\s*\d*)?\s*[:=]\s*(.+)$/i)
    if (marker) {
      const name = marker[1].trim()
      if (name && !/^(none|null|unknown)$/i.test(name)) names.push(name)
      continue
    }
    const adapter = line.match(/\b((?:NVIDIA|AMD|Intel|Microsoft|Qualcomm|Radeon|GeForce|Arc)\b[^|;]{2,70})/i)
    if (adapter) names.push(adapter[1].trim())
  }
  return Array.from(new Set(names))
}
