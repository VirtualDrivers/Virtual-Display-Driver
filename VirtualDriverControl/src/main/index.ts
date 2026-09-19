import { execFile } from 'child_process'
import { app, BrowserWindow, desktopCapturer, nativeImage, nativeTheme, session, shell } from 'electron'
import { writeFileSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { registerIpc } from './ipc'
import { AudioService } from './services/audio-service'
import { DisplayService } from './services/display-service'
import { DriverService } from './services/driver-service'
import { InstallerService } from './services/installer-service'
import { LogService } from './services/log-service'
import { PipeClient } from './services/pipe-client'
import { PrefsService } from './services/prefs-service'
import { SettingsService } from './services/settings-service'

const HEARTBEAT_INTERVAL_MS = 5_000
const execFileAsync = promisify(execFile)

const RESOURCES_DIR = join(__dirname, '../../resources')

// Taskbar/window icon mirrors driver health: normal when the pipe answers,
// yellow when installed but not responding, red when not installed.
const STATUS_ICONS: Record<string, string> = {
  online: join(RESOURCES_DIR, 'VirtualDisplayDriver.ico'),
  'installed-offline': join(RESOURCES_DIR, 'VDD_Yellow.ico'),
  'not-installed': join(RESOURCES_DIR, 'VDD_Red.ico'),
  unknown: join(RESOURCES_DIR, 'VDD_Red.ico')
}

let currentIconLevel = ''

function updateStatusIcon(level: string): void {
  if (!mainWindow || mainWindow.isDestroyed() || level === currentIconLevel) return
  const icon = nativeImage.createFromPath(STATUS_ICONS[level] ?? STATUS_ICONS.unknown)
  mainWindow.setIcon(icon)
  currentIconLevel = level
}

// Mica needs Windows 11 22H2+; everywhere else we fall back to a solid Fluent base.
const supportsMica = process.platform === 'win32' && Number(os.release().split('.')[2] ?? 0) >= 22621

/**
 * Relaunches the app elevated through a single UAC prompt. Returns false when
 * the prompt is declined. A .cmd launcher preserves the dev-server URL so the
 * elevated instance still gets HMR during development.
 */
async function relaunchElevated(): Promise<boolean> {
  const lines = ['@echo off', `cd /d "${process.cwd()}"`]
  for (const key of ['ELECTRON_RENDERER_URL', 'NODE_ENV']) {
    const value = process.env[key]
    if (value) lines.push(`set "${key}=${value}"`)
  }
  const args = process.argv
    .slice(1)
    .map((a) => `"${a}"`)
    .join(' ')
  lines.push(`start "" "${process.execPath}" ${args}`)

  const cmdPath = join(app.getPath('temp'), `vdd-elevate-${Date.now()}.cmd`)
  writeFileSync(cmdPath, lines.join('\r\n'), 'utf8')
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Start-Process -FilePath '${cmdPath}' -Verb RunAs -WindowStyle Hidden`],
      { windowsHide: true, timeout: 120_000 }
    )
    return true
  } catch {
    // UAC declined
    return false
  }
}

let mainWindow: BrowserWindow | null = null
let heartbeatBusy = false

const prefs = new PrefsService()
const pipe = new PipeClient()
const settings = new SettingsService(() => prefs.getBaseDir())
const driver = new DriverService(pipe, { getBaseDir: () => prefs.getBaseDir() })
const logs = new LogService(pipe, () => prefs.getBaseDir())
const installer = new InstallerService(
  () => prefs.getBaseDir(),
  () => driver.isAdmin(),
  (progress) => send('push:install-progress', progress)
)
const audio = new AudioService()
const displays = new DisplayService()

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    frame: false,
    show: false,
    ...(supportsMica ? { backgroundMaterial: 'mica' as const } : { backgroundColor: '#202020' }),
    icon: join(RESOURCES_DIR, 'VirtualDisplayDriver.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      additionalArguments: [`--vdd-backdrop=${supportsMica ? 'mica' : 'solid'}`]
    }
  })

  mainWindow.on('ready-to-show', () => {
    // Re-assert the material - it can fail to apply on frameless windows
    // when only passed through the constructor.
    if (supportsMica) mainWindow?.setBackgroundMaterial('mica')
    mainWindow?.show()
  })
  mainWindow.on('maximize', () => send('push:maximized', true))
  mainWindow.on('unmaximize', () => send('push:maximized', false))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // All external navigation goes through the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function heartbeat(): Promise<void> {
  if (heartbeatBusy) return
  heartbeatBusy = true
  try {
    const status = await driver.status()
    updateStatusIcon(status.level)
    send('push:status', status)
  } finally {
    heartbeatBusy = false
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // Ask for elevation up front so the driver folder, VDDPATH registry and
    // device operations all work without per-operation prompts. Declining
    // keeps the app fully usable as a standard user.
    if (!(await driver.isAdmin())) {
      app.releaseSingleInstanceLock()
      if (await relaunchElevated()) {
        if (app.isPackaged) {
          app.exit(0)
        }
        // In dev the parent must stay alive (windowless) so the Vite dev
        // server keeps running for the elevated instance.
        return
      }
      app.requestSingleInstanceLock()
    }

    // Mica's tint follows nativeTheme - align it with the saved app theme.
    nativeTheme.themeSource = prefs.get().theme

    registerIpc({ pipe, settings, driver, logs, prefs, installer, audio, displays }, () => mainWindow)

    // The driver reads vdd_settings.xml from its VDDPATH registry value -
    // follow it so the app always edits the file the driver actually loads,
    // and seed the folder with defaults when it does not exist yet.
    void prefs.syncBaseDirWithDriver().then(() => settings.ensureDefaults())

    // Microphone capture powers the audio router; everything else stays denied.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media')
    })
    // getDisplayMedia with system audio loopback ("System audio" route source).
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch(() => callback({}))
    })

    displays.watch(() => {
      void displays.layout().then((layout) => send('push:displays', layout))
    })

    logs.on('events', (events) => send('push:logs', events))
    pipe.on('result', (result) =>
      send('push:pipe-activity', {
        command: result.command,
        ok: result.ok,
        durationMs: result.durationMs,
        at: Date.now()
      })
    )

    logs.start()
    logs.appInfo('Virtual Driver Control started')

    createWindow()

    void heartbeat()
    setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    logs.stop()
    app.quit()
  })
}
