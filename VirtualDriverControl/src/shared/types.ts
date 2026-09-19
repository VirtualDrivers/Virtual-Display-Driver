/**
 * Shared type contract between the main process, preload bridge and renderer.
 */

// ---------------------------------------------------------------------------
// vdd_settings.xml model
// ---------------------------------------------------------------------------

export type ColourFormat = 'RGB' | 'YCbCr444' | 'YCbCr422' | 'YCbCr420'

export interface ResolutionEntry {
  width: number
  height: number
  /** Per-resolution refresh rates (Hz). Fractional rates like 59.94 allowed. */
  refreshRates: number[]
}

export interface VddSettings {
  monitors: { count: number }
  gpu: { friendlyName: string }
  global: { refreshRates: number[] }
  resolutions: ResolutionEntry[]
  logging: {
    sendLogsThroughPipe: boolean
    logging: boolean
    debugLogging: boolean
  }
  colour: {
    sdr10bit: boolean
    hdrPlus: boolean
    colourFormat: ColourFormat
  }
  cursor: {
    hardwareCursor: boolean
    cursorMaxX: number
    cursorMaxY: number
    alphaCursorSupport: boolean
    xorCursorSupportLevel: number
  }
  edid: {
    customEdid: boolean
    preventSpoof: boolean
    edidCeaOverride: boolean
  }
  edidIntegration: {
    enabled: boolean
    autoConfigureFromEdid: boolean
    edidProfilePath: string
    overrideManualSettings: boolean
    fallbackOnError: boolean
  }
  hdrAdvanced: {
    hdr10StaticMetadata: {
      enabled: boolean
      maxDisplayMasteringLuminance: number
      minDisplayMasteringLuminance: number
      maxContentLightLevel: number
      maxFrameAvgLightLevel: number
    }
    colorPrimaries: {
      enabled: boolean
      redX: number
      redY: number
      greenX: number
      greenY: number
      blueX: number
      blueY: number
      whiteX: number
      whiteY: number
    }
    colorSpace: {
      enabled: boolean
      gammaCorrection: number
      primaryColorSpace: string
      enableMatrixTransform: boolean
    }
  }
  autoResolutions: {
    enabled: boolean
    sourcePriority: string
    edidModeFiltering: {
      minRefreshRate: number
      maxRefreshRate: number
      excludeFractionalRates: boolean
      minResolutionWidth: number
      minResolutionHeight: number
      maxResolutionWidth: number
      maxResolutionHeight: number
    }
    preferredMode: {
      useEdidPreferred: boolean
      fallbackWidth: number
      fallbackHeight: number
      fallbackRefresh: number
    }
  }
  colorAdvanced: {
    bitDepthManagement: {
      autoSelectFromColorSpace: boolean
      forceBitDepth: number
      fp16SurfaceSupport: boolean
    }
    colorFormatExtended: {
      sdrWhiteLevel: number
    }
  }
}

// ---------------------------------------------------------------------------
// Named pipe protocol
// ---------------------------------------------------------------------------

/** Toggle commands understood by the driver pipe. */
export type PipeToggleCommand =
  | 'HDRPLUS'
  | 'SDR10'
  | 'CUSTOMEDID'
  | 'PREVENTSPOOF'
  | 'CEAOVERRIDE'
  | 'HARDWARECURSOR'
  | 'LOGGING'
  | 'LOG_DEBUG'

export interface PipeResult {
  ok: boolean
  command: string
  /** Decoded response payload (log lines for most commands). */
  response: string
  lines: string[]
  durationMs: number
  error?: string
}

export interface DriverLiveSettings {
  debug: boolean
  log: boolean
}

// ---------------------------------------------------------------------------
// Driver status
// ---------------------------------------------------------------------------

export type DriverStatusLevel =
  | 'online' // pipe answers PING
  | 'installed-offline' // device or DLL present, pipe not answering
  | 'not-installed'
  | 'unknown'

export interface DriverStatus {
  level: DriverStatusLevel
  pipeConnected: boolean
  devicePresent: boolean
  deviceName?: string
  devicePnpStatus?: string
  dllPresent: boolean
  dllDate?: string
  checkedAt: number
}

export interface GpuInfo {
  name: string
  source: 'pipe' | 'wmi'
  assigned: boolean
  driverVersion?: string
  vramMB?: number
}

export interface SystemInfo {
  windowsVersion: string
  windowsBuild: string
  arch: string
  isAdmin: boolean
  appVersion: string
  electronVersion: string
  settingsPath: string
  logsDir: string
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export type LogSeverity = 'debug' | 'info' | 'warning' | 'error'
export type LogSource = 'file' | 'pipe' | 'app'

export interface LogEvent {
  id: number
  timestamp: number
  source: LogSource
  severity: LogSeverity
  message: string
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

export interface BackupInfo {
  fileName: string
  fullPath: string
  createdAt: number
  sizeBytes: number
}

export interface SettingsLoadResult {
  ok: boolean
  settings?: VddSettings
  rawXml?: string
  /** True when the file did not exist and defaults were returned. */
  isDefault: boolean
  error?: string
}

export interface SaveResult {
  ok: boolean
  backupCreated?: string
  error?: string
}

// ---------------------------------------------------------------------------
// EDID
// ---------------------------------------------------------------------------

export interface EdidTiming {
  width: number
  height: number
  refreshHz: number
  interlaced?: boolean
  source: 'detailed' | 'standard' | 'established' | 'cea-vic'
  pixelClockMHz?: number
  vic?: number
  native?: boolean
}

export interface EdidChromaticity {
  redX: number
  redY: number
  greenX: number
  greenY: number
  blueX: number
  blueY: number
  whiteX: number
  whiteY: number
}

export interface EdidHdrMetadata {
  eotfSdr: boolean
  eotfHdr: boolean
  eotfPq: boolean
  eotfHlg: boolean
  maxLuminance?: number
  maxFrameAvgLuminance?: number
  minLuminance?: number
}

export interface ParsedEdid {
  valid: boolean
  errors: string[]
  manufacturerId: string
  productCode: number
  serialNumber: number
  serialString?: string
  displayName?: string
  manufactureWeek: number
  manufactureYear: number
  edidVersion: string
  digital: boolean
  bitDepth?: number
  videoInterface?: string
  screenWidthCm?: number
  screenHeightCm?: number
  gamma?: number
  chromaticity?: EdidChromaticity
  timings: EdidTiming[]
  preferred?: EdidTiming
  extensionCount: number
  hasCeaExtension: boolean
  ceaYcbcr444?: boolean
  ceaYcbcr422?: boolean
  ceaBasicAudio?: boolean
  hdr?: EdidHdrMetadata
  checksumOk: boolean
  rawBytes: number
}

// ---------------------------------------------------------------------------
// Driver installer (GitHub releases)
// ---------------------------------------------------------------------------

/** Drivers managed by the lifecycle installer. */
export type ManagedDriverId = 'display' | 'audio'

export interface ManagedDeviceState {
  /** Number of root-enumerated device nodes present. */
  count: number
  /** PnP status of each device (OK, Error, ...). */
  statuses: string[]
}

export interface ReleaseInfo {
  tag: string
  name: string
  publishedAt: string
  notes: string
  htmlUrl: string
  asset: {
    name: string
    sizeBytes: number
    downloadUrl: string
    sha256?: string
  } | null
}

export type InstallPhase = 'download' | 'verify' | 'extract' | 'install' | 'finalize'

export interface InstallProgress {
  phase: InstallPhase
  /** 0-100 within the current phase; -1 = indeterminate. */
  percent: number
  message: string
}

export interface LifecycleResult {
  ok: boolean
  /** Tail of the elevated operation's log. */
  detail?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Windows audio endpoints
// ---------------------------------------------------------------------------

export type AudioFlow = 'render' | 'capture'

export interface AudioEndpoint {
  /** MMDevice endpoint ID, e.g. {0.0.0.00000000}.{guid}. */
  id: string
  name: string
  flow: AudioFlow
  isDefault: boolean
  isDefaultComm: boolean
  /** Master volume scalar 0..1. */
  volume: number
  muted: boolean
  /** True when the endpoint belongs to the Virtual Audio Driver. */
  isVirtual: boolean
}

// ---------------------------------------------------------------------------
// Audio routing (renderer-side WebAudio pump, persisted in prefs)
// ---------------------------------------------------------------------------

/** Source id for routing system output audio (WASAPI loopback of default output). */
export const SYSTEM_AUDIO_SOURCE = 'system-loopback'

export interface AudioRoute {
  id: string
  /** Web `MediaDeviceInfo.deviceId` of an audioinput, or SYSTEM_AUDIO_SOURCE. */
  sourceId: string
  sourceLabel: string
  /** Web `MediaDeviceInfo.deviceId` of an audiooutput. */
  sinkId: string
  sinkLabel: string
  /** Gain 0..2 (1 = unity). */
  gain: number
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Display layout (physical + virtual monitors)
// ---------------------------------------------------------------------------

export interface DisplayLayoutInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  rotation: number
  frequency: number
  internal: boolean
  primary: boolean
  /** True when the monitor hangs off the MttVDD virtual adapter. */
  isVirtual: boolean
  colorDepth: number
}

// ---------------------------------------------------------------------------
// App preferences (renderer-local, persisted via main)
// ---------------------------------------------------------------------------

export interface AppPreferences {
  theme: 'dark' | 'light' | 'system'
  accent: string
  baseDir: string
  /** Saved audio routes, re-armed on app start. */
  audioRoutes: AudioRoute[]
}

export const DEFAULT_BASE_DIR = 'C:\\VirtualDisplayDriver'

/** Result of changing the driver folder (prefs + VDDPATH registry together). */
export interface BaseDirResult {
  ok: boolean
  prefs: AppPreferences
  error?: string
}

// ---------------------------------------------------------------------------
// IPC event channel payloads (main -> renderer push)
// ---------------------------------------------------------------------------

export interface PipeActivity {
  command: string
  ok: boolean
  durationMs: number
  at: number
}
