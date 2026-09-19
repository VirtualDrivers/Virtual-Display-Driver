import {
  Activity,
  Bug,
  Cpu,
  FileText,
  HardDrive,
  Layers,
  MonitorPlay,
  MousePointer2,
  ScanEye,
  ShieldAlert,
  Sparkles,
  Sun
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PipeToggleCommand } from '@shared/types'
import { Card, Toggle } from '@renderer/components/ui'
import { DisplayCanvas, useDisplayLayout } from '@renderer/components/ArrangementMap'
import { DriverLifecycle } from '@renderer/components/DriverLifecycle'
import { useDriver } from '@renderer/stores/driver'
import { useSettings } from '@renderer/stores/settings'
import { useUi } from '@renderer/stores/ui'

interface QuickToggleDef {
  command: PipeToggleCommand
  label: string
  sub: string
  icon: LucideIcon
  get: (s: ReturnType<typeof useSettings.getState>['draft']) => boolean
}

const QUICK_TOGGLES: QuickToggleDef[] = [
  { command: 'HDRPLUS', label: 'HDR+', sub: 'High dynamic range output', icon: Sparkles, get: (s) => s.colour.hdrPlus },
  { command: 'SDR10', label: 'SDR 10-bit', sub: '10-bit color in SDR mode', icon: Sun, get: (s) => s.colour.sdr10bit },
  {
    command: 'HARDWARECURSOR',
    label: 'Hardware cursor',
    sub: 'GPU-composited cursor',
    icon: MousePointer2,
    get: (s) => s.cursor.hardwareCursor
  },
  { command: 'CUSTOMEDID', label: 'Custom EDID', sub: 'Use user_edid.bin identity', icon: ScanEye, get: (s) => s.edid.customEdid },
  { command: 'LOGGING', label: 'File logging', sub: 'Write driver log files', icon: FileText, get: (s) => s.logging.logging },
  { command: 'LOG_DEBUG', label: 'Debug logging', sub: 'Verbose troubleshooting logs', icon: Bug, get: (s) => s.logging.debugLogging }
]

const LEVEL_LABEL: Record<string, string> = {
  online: 'Online',
  'installed-offline': 'Not responding',
  'not-installed': 'Not installed',
  unknown: 'Checking…'
}

export function DashboardPage(): React.JSX.Element {
  const status = useDriver((s) => s.status)
  const iddcx = useDriver((s) => s.iddcx)
  const busy = useDriver((s) => s.busy)
  const quickToggle = useDriver((s) => s.quickToggle)
  const sysInfo = useDriver((s) => s.sysInfo)
  const draft = useSettings((s) => s.draft)
  const isDefault = useSettings((s) => s.isDefault)
  const setPage = useUi((s) => s.setPage)
  const { displays } = useDisplayLayout()

  const online = status?.pipeConnected === true
  const attachedVirtual = displays.filter((d) => d.isVirtual).length
  const attachedPhysical = displays.length - attachedVirtual

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Live control of your virtual displays</p>
        </div>
      </div>

      {status?.level === 'not-installed' && (
        <div className="banner warn">
          <ShieldAlert size={16} />
          <span>
            The Virtual Display Driver is not installed on this system. You can still edit and stage configuration - use the
            driver lifecycle card below to download and install the latest official release.
          </span>
        </div>
      )}

      {isDefault && status?.level !== 'not-installed' && (
        <div className="banner info">
          <FileText size={16} />
          <span>No vdd_settings.xml found - showing defaults. Saving will create the configuration file.</span>
        </div>
      )}

      <Card
        icon={MonitorPlay}
        title="Displays"
        subtitle={
          online ? 'Live desktop - virtual display changes apply instantly' : 'Live desktop - driver offline, virtual count is staged'
        }
      >
        <DisplayCanvas />
      </Card>

      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-label">
            <Activity size={11} /> Driver
          </span>
          <span className="stat-value" style={{ color: online ? 'var(--success)' : status?.level === 'not-installed' ? 'var(--danger)' : 'var(--warning)' }}>
            {LEVEL_LABEL[status?.level ?? 'unknown']}
          </span>
          <span className="stat-sub">{status?.deviceName ?? 'Root\\MttVDD'}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">
            <Layers size={11} /> Active displays
          </span>
          <span className="stat-value">{displays.length > 0 ? displays.length : '—'}</span>
          <span className="stat-sub">
            {displays.length > 0 ? `${attachedPhysical} physical · ${attachedVirtual} virtual · ` : ''}
            {draft.monitors.count} configured
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">
            <Cpu size={11} /> GPU
          </span>
          <span className="stat-value" title={draft.gpu.friendlyName}>
            {draft.gpu.friendlyName === 'default' ? 'System default' : draft.gpu.friendlyName}
          </span>
          <span className="stat-sub">
            <button type="button" className="btn ghost small" style={{ padding: '1px 6px', marginLeft: -6 }} onClick={() => setPage('gpu')}>
              Manage →
            </button>
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">
            <HardDrive size={11} /> IddCx
          </span>
          <span className="stat-value">{iddcx ?? '—'}</span>
          <span className="stat-sub">{status?.dllPresent ? `MttVDD.dll · ${status.dllDate ?? ''}` : 'driver DLL not found'}</span>
        </div>
        {sysInfo && (
          <div className="stat-tile">
            <span className="stat-label">
              <ShieldAlert size={11} /> Session
            </span>
            <span className="stat-value">{sysInfo.isAdmin ? 'Administrator' : 'Standard user'}</span>
            <span className="stat-sub">{sysInfo.windowsVersion}</span>
          </div>
        )}
      </div>

      <DriverLifecycle driver="display" />

      <Card
        icon={Sparkles}
        title="Quick toggles"
        subtitle={online ? 'Applied live via the driver pipe - some toggles trigger a short reload' : 'Driver offline - toggles stage into the draft configuration'}
      >
        <div className="quick-toggles">
          {QUICK_TOGGLES.map((def) => {
            const Icon = def.icon
            const value = def.get(draft)
            return (
              <div key={def.command} className={`quick-toggle ${value ? 'on' : ''}`}>
                <span className="qt-icon">
                  <Icon size={16} />
                </span>
                <div className="qt-text">
                  <div className="qt-title">{def.label}</div>
                  <div className="qt-sub">{def.sub}</div>
                </div>
                <Toggle checked={value} disabled={busy !== null} onChange={(v) => void quickToggle(def.command, v, def.label)} />
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
