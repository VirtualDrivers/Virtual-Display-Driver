import {
  Cpu,
  LayoutDashboard,
  MonitorCog,
  Palette,
  ScanEye,
  SettingsIcon,
  SquareTerminal,
  Volume2
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useDriver } from '@renderer/stores/driver'
import { useUi, type PageId } from '@renderer/stores/ui'

interface NavEntry {
  id: PageId
  label: string
  icon: LucideIcon
  section?: string
}

const NAV: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'displays', label: 'Displays', icon: MonitorCog, section: 'Configure' },
  { id: 'color', label: 'HDR & Color', icon: Palette },
  { id: 'edid', label: 'EDID Lab', icon: ScanEye },
  { id: 'gpu', label: 'GPU', icon: Cpu },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'console', label: 'Console', icon: SquareTerminal, section: 'Diagnostics' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

export function Sidebar(): React.JSX.Element {
  const page = useUi((s) => s.page)
  const setPage = useUi((s) => s.setPage)
  const sysInfo = useDriver((s) => s.sysInfo)
  const iddcx = useDriver((s) => s.iddcx)

  return (
    <nav className="sidebar">
      {NAV.map((entry) => {
        const Icon = entry.icon
        return (
          <div key={entry.id}>
            {entry.section && <div className="nav-section">{entry.section}</div>}
            <button
              type="button"
              className={`nav-item ${page === entry.id ? 'active' : ''}`}
              style={{ width: '100%' }}
              onClick={() => setPage(entry.id)}
            >
              <Icon size={16} strokeWidth={2.1} />
              {entry.label}
            </button>
          </div>
        )
      })}
      <div className="sidebar-footer">
        <span>v{sysInfo?.appVersion ?? '2.0.0'}</span>
        <span className="mono" style={{ fontSize: 10 }}>
          MttVDD · IddCx{iddcx ? ` ${iddcx}` : ''}
        </span>
      </div>
    </nav>
  )
}
