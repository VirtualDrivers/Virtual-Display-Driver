import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppPreferences,
  AudioEndpoint,
  BackupInfo,
  BaseDirResult,
  DisplayLayoutInfo,
  DriverLiveSettings,
  DriverStatus,
  GpuInfo,
  InstallProgress,
  LifecycleResult,
  LogEvent,
  ManagedDeviceState,
  ManagedDriverId,
  PipeActivity,
  PipeResult,
  PipeToggleCommand,
  ReleaseInfo,
  SaveResult,
  SettingsLoadResult,
  SystemInfo,
  VddSettings
} from '@shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  env: {
    /** Window backdrop chosen by the main process (Mica on Win11 22H2+). */
    backdrop: (process.argv.includes('--vdd-backdrop=mica') ? 'mica' : 'solid') as 'mica' | 'solid'
  },
  pipe: {
    ping: (): Promise<boolean> => ipcRenderer.invoke('pipe:ping'),
    setDisplayCount: (count: number): Promise<PipeResult> => ipcRenderer.invoke('pipe:set-display-count', count),
    toggle: (name: PipeToggleCommand, value: boolean): Promise<PipeResult> => ipcRenderer.invoke('pipe:toggle', name, value),
    setGpu: (name: string): Promise<PipeResult> => ipcRenderer.invoke('pipe:set-gpu', name),
    query: (command: string): Promise<PipeResult> => ipcRenderer.invoke('pipe:query', command),
    sendRaw: (command: string): Promise<PipeResult> => ipcRenderer.invoke('pipe:send-raw', command),
    getDriverSettings: (): Promise<DriverLiveSettings | null> => ipcRenderer.invoke('pipe:get-driver-settings')
  },
  settings: {
    load: (): Promise<SettingsLoadResult> => ipcRenderer.invoke('settings:load'),
    save: (settings: VddSettings): Promise<SaveResult> => ipcRenderer.invoke('settings:save', settings),
    preview: (settings: VddSettings): Promise<string> => ipcRenderer.invoke('settings:preview', settings),
    raw: (): Promise<string | null> => ipcRenderer.invoke('settings:raw'),
    backups: (): Promise<BackupInfo[]> => ipcRenderer.invoke('settings:backups'),
    restore: (fileName: string): Promise<SaveResult> => ipcRenderer.invoke('settings:restore', fileName),
    saveMonitorProfile: (xml: string, edidBytes?: Uint8Array): Promise<SaveResult> =>
      ipcRenderer.invoke('settings:save-monitor-profile', xml, edidBytes)
  },
  driver: {
    status: (force?: boolean): Promise<DriverStatus> => ipcRenderer.invoke('driver:status', force),
    gpus: (): Promise<GpuInfo[]> => ipcRenderer.invoke('driver:gpus'),
    iddcxVersion: (): Promise<string | null> => ipcRenderer.invoke('driver:iddcx-version')
  },
  installer: {
    latestRelease: (driver: ManagedDriverId): Promise<ReleaseInfo> => ipcRenderer.invoke('installer:latest-release', driver),
    installedTag: (driver: ManagedDriverId): Promise<string | null> => ipcRenderer.invoke('installer:installed-tag', driver),
    deviceState: (driver: ManagedDriverId): Promise<ManagedDeviceState> => ipcRenderer.invoke('installer:device-state', driver),
    install: (driver: ManagedDriverId, instances?: number): Promise<LifecycleResult> =>
      ipcRenderer.invoke('installer:install', driver, instances),
    uninstall: (driver: ManagedDriverId): Promise<LifecycleResult> => ipcRenderer.invoke('installer:uninstall', driver),
    restartDevice: (driver: ManagedDriverId): Promise<LifecycleResult> => ipcRenderer.invoke('installer:restart-device', driver),
    setInstances: (driver: ManagedDriverId, count: number): Promise<LifecycleResult> =>
      ipcRenderer.invoke('installer:set-instances', driver, count),
    /** Boot-config test signing state - the audio driver is test-signed and needs it. */
    testSigning: (): Promise<boolean | null> => ipcRenderer.invoke('installer:test-signing'),
    setTestSigning: (enabled: boolean): Promise<LifecycleResult> => ipcRenderer.invoke('installer:set-test-signing', enabled)
  },
  audio: {
    endpoints: (): Promise<AudioEndpoint[]> => ipcRenderer.invoke('audio:endpoints'),
    setDefault: (id: string): Promise<void> => ipcRenderer.invoke('audio:set-default', id),
    setVolume: (id: string, volume: number): Promise<void> => ipcRenderer.invoke('audio:set-volume', id, volume),
    setMute: (id: string, muted: boolean): Promise<void> => ipcRenderer.invoke('audio:set-mute', id, muted)
  },
  system: {
    info: (): Promise<SystemInfo> => ipcRenderer.invoke('system:info'),
    displays: (): Promise<DisplayLayoutInfo[]> => ipcRenderer.invoke('system:displays'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
    openPath: (which: 'base' | 'logs' | 'backups' | 'edid'): Promise<string> => ipcRenderer.invoke('shell:open-path', which)
  },
  logs: {
    recent: (): Promise<LogEvent[]> => ipcRenderer.invoke('logs:recent')
  },
  prefs: {
    get: (): Promise<AppPreferences> => ipcRenderer.invoke('prefs:get'),
    set: (patch: Partial<AppPreferences>): Promise<AppPreferences> => ipcRenderer.invoke('prefs:set', patch),
    /** Changes the driver folder - updates the VDDPATH registry value and the preference atomically. */
    setBaseDir: (baseDir: string): Promise<BaseDirResult> => ipcRenderer.invoke('prefs:set-base-dir', baseDir)
  },
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximizeToggle: (): void => ipcRenderer.send('window:maximize-toggle'),
    close: (): void => ipcRenderer.send('window:close')
  },
  events: {
    onStatus: (cb: (status: DriverStatus) => void): (() => void) => subscribe('push:status', cb),
    onLogs: (cb: (events: LogEvent[]) => void): (() => void) => subscribe('push:logs', cb),
    onPipeActivity: (cb: (activity: PipeActivity) => void): (() => void) => subscribe('push:pipe-activity', cb),
    onMaximized: (cb: (maximized: boolean) => void): (() => void) => subscribe('push:maximized', cb),
    onInstallProgress: (cb: (progress: InstallProgress) => void): (() => void) => subscribe('push:install-progress', cb),
    onDisplays: (cb: (layout: DisplayLayoutInfo[]) => void): (() => void) => subscribe('push:displays', cb)
  }
}

export type VddApi = typeof api

contextBridge.exposeInMainWorld('vdd', api)
