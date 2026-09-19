import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Eraser, FolderOpen, SendHorizontal, SquareTerminal } from 'lucide-react'
import type { LogSeverity, LogSource } from '@shared/types'
import { useDriver } from '@renderer/stores/driver'
import { useLogs } from '@renderer/stores/logs'
import { useUi } from '@renderer/stores/ui'

const KNOWN_COMMANDS = [
  'PING',
  'GETSETTINGS',
  'SETDISPLAYCOUNT 1',
  'GETALLGPUS',
  'GETASSIGNEDGPU',
  'IDDCXVERSION',
  'D3DDEVICEGPU',
  'HDRPLUS true',
  'SDR10 true',
  'LOGGING true',
  'LOG_DEBUG true',
  'CUSTOMEDID true',
  'PREVENTSPOOF true',
  'CEAOVERRIDE true',
  'HARDWARECURSOR true',
  'SETGPU "name"'
]

const SEVERITIES: LogSeverity[] = ['error', 'warning', 'info', 'debug']
const SOURCES: LogSource[] = ['pipe', 'file', 'app']

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function ConsolePage(): React.JSX.Element {
  const events = useLogs((s) => s.events)
  const severityFilter = useLogs((s) => s.severityFilter)
  const sourceFilter = useLogs((s) => s.sourceFilter)
  const search = useLogs((s) => s.search)
  const autoScroll = useLogs((s) => s.autoScroll)
  const toggleSeverity = useLogs((s) => s.toggleSeverity)
  const toggleSource = useLogs((s) => s.toggleSource)
  const setSearch = useLogs((s) => s.setSearch)
  const setAutoScroll = useLogs((s) => s.setAutoScroll)
  const clear = useLogs((s) => s.clear)
  const online = useDriver((s) => s.status?.pipeConnected === true)
  const toast = useUi((s) => s.toast)

  const [command, setCommand] = useState('')
  const [sending, setSending] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return events.filter(
      (e) =>
        severityFilter.has(e.severity) &&
        sourceFilter.has(e.source) &&
        (needle.length === 0 || e.message.toLowerCase().includes(needle))
    )
  }, [events, severityFilter, sourceFilter, search])

  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [filtered, autoScroll])

  const sendCommand = async (): Promise<void> => {
    const cmd = command.trim()
    if (cmd.length === 0 || sending) return
    if (cmd.toUpperCase() === 'RELOAD_DRIVER') {
      toast('warning', 'RELOAD_DRIVER is blocked', 'It causes undefined behavior in the driver (upstream issue #351). Use SETDISPLAYCOUNT N instead.')
      return
    }
    setSending(true)
    try {
      const result = await window.vdd.pipe.sendRaw(cmd)
      if (!result.ok) toast('error', 'Command failed', result.error)
      setCommand('')
    } catch (error) {
      toast('error', 'Command rejected', error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="page-inner" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Console</h1>
          <p className="page-subtitle">Unified driver activity - file logs, pipe traffic and app events</p>
        </div>
        <div className="row">
          <button type="button" className="btn ghost small" onClick={() => void window.vdd.system.openPath('logs')}>
            <FolderOpen size={13} /> Logs folder
          </button>
          <button type="button" className="btn ghost small" onClick={clear}>
            <Eraser size={13} /> Clear
          </button>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        {SEVERITIES.map((sev) => (
          <button
            key={sev}
            type="button"
            className={`chip selectable ${severityFilter.has(sev) ? 'on' : ''}`}
            style={{ background: severityFilter.has(sev) ? undefined : 'transparent', font: 'inherit' }}
            onClick={() => toggleSeverity(sev)}
          >
            {sev}
          </button>
        ))}
        <span style={{ width: 10 }} />
        {SOURCES.map((src) => (
          <button
            key={src}
            type="button"
            className={`chip selectable ${sourceFilter.has(src) ? 'on' : ''}`}
            style={{ background: sourceFilter.has(src) ? undefined : 'transparent', font: 'inherit' }}
            onClick={() => toggleSource(src)}
          >
            {src}
          </button>
        ))}
        <input
          type="text"
          placeholder="Filter messages…"
          value={search}
          style={{ width: 200, marginLeft: 'auto' }}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className={`chip selectable ${autoScroll ? 'on' : ''}`}
          style={{ background: autoScroll ? undefined : 'transparent', font: 'inherit' }}
          onClick={() => setAutoScroll(!autoScroll)}
          title="Auto-scroll to newest"
        >
          <ArrowDownToLine size={12} /> follow
        </button>
      </div>

      <div ref={feedRef} className="console-feed" style={{ flex: 1, minHeight: 280 }}>
        {filtered.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-faint)' }}>
            <SquareTerminal size={26} strokeWidth={1.5} style={{ marginBottom: 8 }} />
            <div>No log activity yet{online ? ' - try sending PING below' : ''}</div>
          </div>
        )}
        {filtered.map((event) => (
          <div key={event.id} className="console-line">
            <span className="ts">{formatTime(event.timestamp)}</span>
            <span className={`src ${event.source}`}>{event.source}</span>
            <span className={`msg ${event.severity}`}>{event.message}</span>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 9 }}>
        <input
          type="text"
          className="mono"
          list="pipe-commands"
          placeholder={online ? 'Send a raw pipe command, e.g. PING' : 'Driver offline - pipe commands unavailable'}
          value={command}
          disabled={!online}
          style={{ flex: 1 }}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void sendCommand()}
        />
        <datalist id="pipe-commands">
          {KNOWN_COMMANDS.map((cmd) => (
            <option key={cmd} value={cmd} />
          ))}
        </datalist>
        <button type="button" className="btn primary" disabled={!online || sending || command.trim().length === 0} onClick={() => void sendCommand()}>
          <SendHorizontal size={14} />
          Send
        </button>
      </div>
    </div>
  )
}
