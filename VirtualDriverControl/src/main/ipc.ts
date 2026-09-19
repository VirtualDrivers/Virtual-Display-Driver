import { BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import type { AppPreferences, ManagedDriverId, PipeToggleCommand, VddSettings } from '@shared/types'
import type { AudioService } from './services/audio-service'
import type { DisplayService } from './services/display-service'
import type { DriverService } from './services/driver-service'
import type { InstallerService } from './services/installer-service'
import type { LogService } from './services/log-service'
import type { PipeClient } from './services/pipe-client'
import type { PrefsService } from './services/prefs-service'
import type { SettingsService } from './services/settings-service'

const TOGGLE_COMMANDS: ReadonlySet<string> = new Set([
  'HDRPLUS',
  'SDR10',
  'CUSTOMEDID',
  'PREVENTSPOOF',
  'CEAOVERRIDE',
  'HARDWARECURSOR',
  'LOGGING',
  'LOG_DEBUG'
])

const QUERY_COMMANDS: ReadonlySet<string> = new Set(['D3DDEVICEGPU', 'IDDCXVERSION', 'GETASSIGNEDGPU', 'GETALLGPUS', 'GETSETTINGS', 'PING'])

/** Raw console commands: known verbs only, conservative charset for arguments. */
const RAW_COMMAND_PATTERN = /^[A-Za-z0-9_]+(?: [A-Za-z0-9_." -]{1,100})?$/

export interface IpcServices {
  pipe: PipeClient
  settings: SettingsService
  driver: DriverService
  logs: LogService
  prefs: PrefsService
  installer: InstallerService
  audio: AudioService
  displays: DisplayService
}

function assertDriverId(value: unknown): asserts value is ManagedDriverId {
  if (value !== 'display' && value !== 'audio') throw new Error('Unknown driver id')
}

export function registerIpc(services: IpcServices, getWindow: () => BrowserWindow | null): void {
  const { pipe, settings, driver, logs, prefs, installer, audio, displays } = services

  // --- Pipe -----------------------------------------------------------------
  ipcMain.handle('pipe:ping', () => pipe.ping())

  ipcMain.handle('pipe:set-display-count', (_e, count: unknown) => {
    const n = Number(count)
    if (!Number.isFinite(n) || n < 0 || n > 16) throw new Error('Display count must be between 0 and 16')
    return pipe.setDisplayCount(n)
  })

  ipcMain.handle('pipe:toggle', (_e, name: unknown, value: unknown) => {
    if (typeof name !== 'string' || !TOGGLE_COMMANDS.has(name)) throw new Error('Unknown toggle command')
    return pipe.setToggle(name as PipeToggleCommand, value === true)
  })

  ipcMain.handle('pipe:set-gpu', (_e, name: unknown) => {
    if (typeof name !== 'string' || name.trim().length === 0) throw new Error('GPU name required')
    return pipe.setGpu(name.trim())
  })

  ipcMain.handle('pipe:query', (_e, command: unknown) => {
    if (typeof command !== 'string' || !QUERY_COMMANDS.has(command)) throw new Error('Unknown query command')
    return pipe.send(command)
  })

  ipcMain.handle('pipe:send-raw', (_e, command: unknown) => {
    if (typeof command !== 'string') throw new Error('Command must be a string')
    const trimmed = command.trim()
    if (trimmed.length === 0 || trimmed.length > 127) throw new Error('Command must be 1-127 characters')
    if (!RAW_COMMAND_PATTERN.test(trimmed)) throw new Error('Command contains unsupported characters')
    return pipe.send(trimmed)
  })

  ipcMain.handle('pipe:get-driver-settings', () => pipe.getDriverSettings())

  // --- vdd_settings.xml -------------------------------------------------------
  ipcMain.handle('settings:load', () => settings.load())

  ipcMain.handle('settings:save', (_e, value: unknown) => {
    assertSettingsShape(value)
    return settings.save(value)
  })

  ipcMain.handle('settings:preview', (_e, value: unknown) => {
    assertSettingsShape(value)
    return settings.serialize(value)
  })

  ipcMain.handle('settings:raw', () => settings.rawXml())
  ipcMain.handle('settings:backups', () => settings.listBackups())

  ipcMain.handle('settings:restore', (_e, fileName: unknown) => {
    if (typeof fileName !== 'string') throw new Error('Backup file name required')
    return settings.restoreBackup(fileName)
  })

  ipcMain.handle('settings:save-monitor-profile', (_e, xml: unknown, bytes: unknown) => {
    if (typeof xml !== 'string' || !xml.includes('<IddCxMonitorConfig>')) throw new Error('Invalid monitor profile XML')
    const edidBytes = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : undefined
    return settings.saveMonitorProfile(xml, edidBytes)
  })

  // --- Driver / system --------------------------------------------------------
  ipcMain.handle('driver:status', (_e, force: unknown) => driver.status(force === true))
  ipcMain.handle('driver:gpus', () => driver.gpus())
  ipcMain.handle('driver:iddcx-version', () => driver.iddcxVersion())
  ipcMain.handle('system:info', () => driver.systemInfo())

  // --- Driver lifecycle (download / install / uninstall / restart) -------------
  ipcMain.handle('installer:latest-release', (_e, driverId: unknown) => {
    assertDriverId(driverId)
    return installer.latestRelease(driverId)
  })
  ipcMain.handle('installer:installed-tag', (_e, driverId: unknown) => {
    assertDriverId(driverId)
    return installer.installedReleaseTag(driverId)
  })
  ipcMain.handle('installer:device-state', (_e, driverId: unknown) => {
    assertDriverId(driverId)
    return installer.deviceState(driverId)
  })
  ipcMain.handle('installer:install', (_e, driverId: unknown, instances: unknown) => {
    assertDriverId(driverId)
    const n = instances === undefined ? 1 : Number(instances)
    if (!Number.isFinite(n) || n < 1 || n > 4) throw new Error('Instance count must be between 1 and 4')
    return installer.downloadAndInstall(driverId, n)
  })
  ipcMain.handle('installer:uninstall', (_e, driverId: unknown) => {
    assertDriverId(driverId)
    return installer.uninstall(driverId)
  })
  ipcMain.handle('installer:restart-device', (_e, driverId: unknown) => {
    assertDriverId(driverId)
    return installer.restartDevice(driverId)
  })
  ipcMain.handle('installer:set-instances', (_e, driverId: unknown, count: unknown) => {
    assertDriverId(driverId)
    const n = Number(count)
    if (!Number.isFinite(n) || n < 1 || n > 4) throw new Error('Instance count must be between 1 and 4')
    return installer.setInstances(driverId, n)
  })
  ipcMain.handle('installer:test-signing', () => installer.testSigningEnabled())
  ipcMain.handle('installer:set-test-signing', (_e, enabled: unknown) => installer.setTestSigning(enabled === true))

  // --- Windows audio endpoints ---------------------------------------------------
  ipcMain.handle('audio:endpoints', () => audio.listEndpoints())
  ipcMain.handle('audio:set-default', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Endpoint id required')
    return audio.setDefaultEndpoint(id)
  })
  ipcMain.handle('audio:set-volume', (_e, id: unknown, volume: unknown) => {
    if (typeof id !== 'string') throw new Error('Endpoint id required')
    const v = Number(volume)
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error('Volume must be 0..1')
    return audio.setVolume(id, v)
  })
  ipcMain.handle('audio:set-mute', (_e, id: unknown, muted: unknown) => {
    if (typeof id !== 'string') throw new Error('Endpoint id required')
    return audio.setMute(id, muted === true)
  })

  // --- Display layout --------------------------------------------------------------
  ipcMain.handle('system:displays', () => displays.layout())

  // --- Logs --------------------------------------------------------------------
  ipcMain.handle('logs:recent', () => logs.recent())

  // --- Preferences --------------------------------------------------------------
  ipcMain.handle('prefs:get', () => prefs.get())
  ipcMain.handle('prefs:set', (_e, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) throw new Error('Invalid preferences')
    // baseDir changes must go through prefs:set-base-dir so the driver's
    // VDDPATH registry value always stays in sync.
    const rest = { ...(patch as Partial<AppPreferences>) }
    delete rest.baseDir
    const next = prefs.set(rest)
    // Keep the Mica backdrop tint in step with the in-app theme.
    nativeTheme.themeSource = next.theme
    return next
  })
  ipcMain.handle('prefs:set-base-dir', async (_e, baseDir: unknown) => {
    if (typeof baseDir !== 'string' || baseDir.trim().length === 0) throw new Error('Path required')
    const result = await prefs.setBaseDir(baseDir)
    // Seed the new location with defaults so the driver finds a config there.
    if (result.ok) await settings.ensureDefaults()
    return result
  })

  // --- Shell ----------------------------------------------------------------------
  ipcMain.handle('shell:open-external', (_e, url: unknown) => {
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('Only https links may be opened')
    return shell.openExternal(url)
  })

  ipcMain.handle('shell:open-path', (_e, which: unknown) => {
    const base = prefs.getBaseDir()
    const targets: Record<string, string> = {
      base,
      logs: `${base}\\Logs`,
      backups: `${base}\\Backups`,
      edid: `${base}\\EDID`
    }
    const target = typeof which === 'string' ? targets[which] : undefined
    if (!target) throw new Error('Unknown folder')
    return shell.openPath(target)
  })

  // --- Window controls --------------------------------------------------------------
  ipcMain.on('window:minimize', () => getWindow()?.minimize())
  ipcMain.on('window:maximize-toggle', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', () => getWindow()?.close())
}

function assertSettingsShape(value: unknown): asserts value is VddSettings {
  if (typeof value !== 'object' || value === null) throw new Error('Settings payload must be an object')
  const v = value as Record<string, unknown>
  for (const key of [
    'monitors',
    'gpu',
    'global',
    'resolutions',
    'logging',
    'colour',
    'cursor',
    'edid',
    'edidIntegration',
    'hdrAdvanced',
    'autoResolutions',
    'colorAdvanced'
  ]) {
    if (!(key in v)) throw new Error(`Settings payload missing section: ${key}`)
  }
  if (!Array.isArray(v.resolutions)) throw new Error('resolutions must be an array')
}
