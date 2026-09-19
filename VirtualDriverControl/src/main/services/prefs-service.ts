import { execFile } from 'child_process'
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { DEFAULT_BASE_DIR, type AppPreferences, type BaseDirResult } from '@shared/types'

const execFileAsync = promisify(execFile)

/** Registry location the driver reads its settings path from (confirmed in MttVDD.dll). */
const VDD_REG_KEY = 'HKLM\\SOFTWARE\\MikeTheTech\\VirtualDisplayDriver'
const VDD_REG_VALUE = 'VDDPATH'

/** Absolute Windows path without characters that would break quoting. */
const SAFE_PATH_PATTERN = /^[A-Za-z]:\\[^"'<>|?*\r\n]*$/

const DEFAULT_PREFS: AppPreferences = {
  theme: 'dark',
  accent: '#4cc2ff',
  baseDir: DEFAULT_BASE_DIR,
  audioRoutes: []
}

export class PrefsService {
  private prefs: AppPreferences

  constructor() {
    this.prefs = this.read()
  }

  get(): AppPreferences {
    return this.prefs
  }

  getBaseDir(): string {
    return this.prefs.baseDir || DEFAULT_BASE_DIR
  }

  set(patch: Partial<AppPreferences>): AppPreferences {
    const next: AppPreferences = { ...this.prefs, ...patch }
    if (typeof next.baseDir !== 'string' || next.baseDir.trim().length === 0) next.baseDir = DEFAULT_BASE_DIR
    if (!/^#[0-9a-fA-F]{6}$/.test(next.accent)) next.accent = DEFAULT_PREFS.accent
    if (!['dark', 'light', 'system'].includes(next.theme)) next.theme = 'dark'
    if (!Array.isArray(next.audioRoutes)) next.audioRoutes = []
    next.audioRoutes = next.audioRoutes.slice(0, 16).filter(
      (r) => typeof r?.id === 'string' && typeof r?.sourceId === 'string' && typeof r?.sinkId === 'string'
    )
    this.prefs = next
    this.write()
    return this.prefs
  }

  /**
   * Reads the driver's VDDPATH registry value. The driver loads
   * `<VDDPATH>\vdd_settings.xml`, defaulting to C:\VirtualDisplayDriver when
   * the value is absent - so the app must follow it to edit the real file.
   */
  async readDriverRegistryPath(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', VDD_REG_KEY, '/v', VDD_REG_VALUE], {
        windowsHide: true,
        timeout: 10_000
      })
      const match = new RegExp(`${VDD_REG_VALUE}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)`).exec(stdout)
      const value = match?.[1]?.trim()
      return value && value.length > 0 ? value : null
    } catch {
      return null
    }
  }

  /**
   * Aligns the app's base dir with what the driver will actually read:
   * the VDDPATH registry value, or C:\VirtualDisplayDriver when unset.
   */
  async syncBaseDirWithDriver(): Promise<void> {
    const effective = normalizePath((await this.readDriverRegistryPath()) ?? DEFAULT_BASE_DIR)
    if (effective.toLowerCase() !== this.getBaseDir().toLowerCase()) {
      this.set({ baseDir: effective })
    }
  }

  /**
   * Changes the driver folder: writes VDDPATH (directly when the app is
   * elevated, otherwise through a single UAC prompt), verifies the registry
   * took the value, and only then updates the preference - so the app and the
   * driver can never point at different places.
   */
  async setBaseDir(rawPath: string): Promise<BaseDirResult> {
    const baseDir = normalizePath(rawPath)
    if (!SAFE_PATH_PATTERN.test(baseDir)) {
      return { ok: false, prefs: this.prefs, error: 'Enter an absolute path like C:\\VirtualDisplayDriver' }
    }

    if (!(await this.writeRegistryDirect(baseDir))) {
      await this.writeRegistryElevated(baseDir)
    }

    const applied = normalizePath((await this.readDriverRegistryPath()) ?? DEFAULT_BASE_DIR)
    if (applied.toLowerCase() !== baseDir.toLowerCase()) {
      // Registry still points elsewhere (UAC declined / write failed).
      await this.syncBaseDirWithDriver()
      return {
        ok: false,
        prefs: this.prefs,
        error: 'The VDDPATH registry value could not be updated (elevation declined?). Folder left unchanged.'
      }
    }

    this.set({ baseDir })
    return { ok: true, prefs: this.prefs }
  }

  private async writeRegistryDirect(baseDir: string): Promise<boolean> {
    try {
      await execFileAsync('reg.exe', ['add', VDD_REG_KEY, '/v', VDD_REG_VALUE, '/t', 'REG_SZ', '/d', baseDir, '/f'], {
        windowsHide: true,
        timeout: 10_000
      })
      return true
    } catch {
      return false
    }
  }

  private async writeRegistryElevated(baseDir: string): Promise<void> {
    const launcher = `$p = Start-Process reg.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList 'add','${VDD_REG_KEY}','/v','${VDD_REG_VALUE}','/t','REG_SZ','/d','"${baseDir}"','/f'; exit $p.ExitCode`
    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', launcher], { windowsHide: true, timeout: 120_000 })
    } catch {
      // verified by re-reading the registry afterwards
    }
  }

  private get filePath(): string {
    return join(app.getPath('userData'), 'preferences.json')
  }

  private read(): AppPreferences {
    try {
      if (existsSync(this.filePath)) {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<AppPreferences>
        // Migrate the pre-WinUI default accent (mint) to the new default.
        if (parsed.accent === '#36c98e') delete parsed.accent
        return { ...DEFAULT_PREFS, ...parsed }
      }
    } catch {
      // fall through to defaults
    }
    return { ...DEFAULT_PREFS }
  }

  private write(): void {
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.prefs, null, 2), 'utf8')
    } catch {
      // non-fatal
    }
  }
}

/** Trims and strips a trailing backslash (keeps drive roots like C:\ intact). */
function normalizePath(value: string): string {
  const trimmed = value.trim()
  return /^[A-Za-z]:\\$/.test(trimmed) ? trimmed : trimmed.replace(/[\\/]+$/, '')
}
