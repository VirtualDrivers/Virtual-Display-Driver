import { execFile } from 'child_process'
import { screen } from 'electron'
import { promisify } from 'util'
import type { DisplayLayoutInfo } from '@shared/types'

const execFileAsync = promisify(execFile)

const VIRTUAL_CACHE_TTL_MS = 30_000

/**
 * Enumerates every attached display (physical and virtual) with real bounds,
 * scale and placement from the Electron `screen` API, and flags monitors that
 * hang off the MttVDD virtual adapter via PnP parent lookup.
 */
export class DisplayService {
  private virtualNames: Set<string> = new Set()
  private virtualCheckedAt = 0
  private refreshing: Promise<void> | null = null
  private notify: (() => void) | null = null

  async layout(): Promise<DisplayLayoutInfo[]> {
    // Never block on the PnP lookup - heuristics cover the first paint and a
    // push event refreshes the flags once the lookup lands.
    void this.refreshVirtualNames()
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: d.label || 'Display',
      bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
      workArea: { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height },
      scaleFactor: d.scaleFactor,
      rotation: d.rotation,
      frequency: Math.round(d.displayFrequency || 0),
      internal: d.internal,
      primary: d.id === primaryId,
      isVirtual: this.isVirtualLabel(d.label),
      colorDepth: d.colorDepth
    }))
  }

  /** Subscribes to display topology changes; returns an unsubscribe function. */
  watch(onChange: () => void): () => void {
    this.notify = onChange
    const handler = (): void => {
      // Topology changed - virtual adapter may have gained/lost monitors.
      this.virtualCheckedAt = 0
      onChange()
    }
    screen.on('display-added', handler)
    screen.on('display-removed', handler)
    screen.on('display-metrics-changed', handler)
    return () => {
      this.notify = null
      screen.removeListener('display-added', handler)
      screen.removeListener('display-removed', handler)
      screen.removeListener('display-metrics-changed', handler)
    }
  }

  private isVirtualLabel(label: string): boolean {
    if (!label) return false
    const norm = label.trim().toLowerCase()
    for (const name of this.virtualNames) {
      if (name === norm || name.includes(norm) || norm.includes(name)) return true
    }
    // Fallback heuristics for when the PnP lookup has not resolved names yet.
    return /vdd|virtual display/i.test(label)
  }

  private async refreshVirtualNames(): Promise<void> {
    if (Date.now() - this.virtualCheckedAt < VIRTUAL_CACHE_TTL_MS) return
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      try {
        // Adapter nodes are matched by hardware ID - instance IDs depend on how
        // the node was created (ROOT\MTTVDD\... vs nefcon's ROOT\DISPLAY\...).
        const script = [
          `$vddIds = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -match '^Root\\\\MttVDD$' } | ForEach-Object { $_.InstanceId })`,
          `$mons = Get-PnpDevice -Class Monitor -PresentOnly -ErrorAction SilentlyContinue`,
          `$out = foreach ($m in $mons) {`,
          `  $parent = (Get-PnpDeviceProperty -InstanceId $m.InstanceId -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue).Data`,
          `  if ($parent -and ($vddIds -contains $parent)) { $m.FriendlyName }`,
          `}`,
          `@($out) | ConvertTo-Json -Compress`
        ].join('; ')
        const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true,
          timeout: 20_000
        })
        const trimmed = stdout.trim()
        const parsed = trimmed ? (JSON.parse(trimmed) as string | string[] | null) : null
        const names = parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed]
        const next = new Set<string>()
        for (const raw of names) {
          if (typeof raw !== 'string') continue
          const full = raw.trim().toLowerCase()
          if (full) next.add(full)
          // PnP reports "Generic Monitor (Odyssey G95C)" while Electron labels
          // are just "Odyssey G95C" - index the parenthesized name too.
          const inner = /\(([^)]+)\)\s*$/.exec(raw)?.[1]?.trim().toLowerCase()
          if (inner) next.add(inner)
        }
        const changed = next.size !== this.virtualNames.size || [...next].some((n) => !this.virtualNames.has(n))
        this.virtualNames = next
        this.virtualCheckedAt = Date.now()
        if (changed) this.notify?.()
      } catch {
        // keep the previous set; heuristics still apply
        this.virtualCheckedAt = Date.now()
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }
}
