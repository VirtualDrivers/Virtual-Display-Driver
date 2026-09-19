import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  AudioLines,
  Check,
  Info,
  Loader2,
  Mic,
  MonitorSpeaker,
  Plus,
  RefreshCw,
  Trash2,
  Volume2,
  VolumeX,
  Waves
} from 'lucide-react'
import type { AudioEndpoint } from '@shared/types'
import { Card, Toggle } from '@renderer/components/ui'
import { DriverLifecycle } from '@renderer/components/DriverLifecycle'
import { SYSTEM_AUDIO_SOURCE, useAudio } from '@renderer/stores/audio'
import { audioRouter } from '@renderer/utils/audio-router'

export function AudioPage(): React.JSX.Element {
  const init = useAudio((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audio</h1>
          <p className="page-subtitle">Virtual audio devices, Windows endpoint control and live routing</p>
        </div>
      </div>

      <DriverLifecycle driver="audio" />
      <EndpointsCard />
      <RoutingCard />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Windows endpoints
// ---------------------------------------------------------------------------

function EndpointsCard(): React.JSX.Element {
  const endpoints = useAudio((s) => s.endpoints)
  const loading = useAudio((s) => s.endpointsLoading)
  const error = useAudio((s) => s.endpointsError)
  const refresh = useAudio((s) => s.refreshEndpoints)

  const outputs = endpoints.filter((e) => e.flow === 'render')
  const inputs = endpoints.filter((e) => e.flow === 'capture')

  return (
    <Card
      icon={MonitorSpeaker}
      title="Windows audio devices"
      subtitle="Active playback and recording endpoints - volume, mute and default device"
      actions={
        <button type="button" className="btn ghost small" disabled={loading} onClick={() => void refresh()}>
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      }
    >
      {error && <div className="banner warn" style={{ marginBottom: 10 }}>{error}</div>}
      {endpoints.length === 0 && !error && (
        <div className="faint">{loading ? 'Enumerating audio endpoints…' : 'No active audio endpoints found.'}</div>
      )}
      <div className="card-grid two">
        <div>
          <div className="nav-section" style={{ margin: '0 0 8px' }}>
            Output · {outputs.length}
          </div>
          <div className="endpoint-list">
            {outputs.map((e) => (
              <EndpointRow key={e.id} endpoint={e} />
            ))}
          </div>
        </div>
        <div>
          <div className="nav-section" style={{ margin: '0 0 8px' }}>
            Input · {inputs.length}
          </div>
          <div className="endpoint-list">
            {inputs.map((e) => (
              <EndpointRow key={e.id} endpoint={e} />
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}

function EndpointRow(props: { endpoint: AudioEndpoint }): React.JSX.Element {
  const { endpoint } = props
  const setVolume = useAudio((s) => s.setEndpointVolume)
  const setMute = useAudio((s) => s.setEndpointMute)
  const setDefault = useAudio((s) => s.setDefaultEndpoint)

  return (
    <div className={`endpoint-row ${endpoint.isVirtual ? 'virtual' : ''}`}>
      <span className="ep-icon">{endpoint.flow === 'render' ? <Volume2 size={15} /> : <Mic size={15} />}</span>
      <div className="ep-main">
        <div className="ep-name" title={endpoint.name}>
          {endpoint.name}
          {endpoint.isVirtual && <span className="ep-badge accent">virtual</span>}
          {endpoint.isDefault && <span className="ep-badge">default</span>}
          {endpoint.isDefaultComm && <span className="ep-badge dim">comms</span>}
        </div>
        <div className="ep-controls">
          <button
            type="button"
            className={`btn ghost small icon-only ${endpoint.muted ? 'danger' : ''}`}
            aria-label={endpoint.muted ? 'Unmute' : 'Mute'}
            onClick={() => void setMute(endpoint.id, !endpoint.muted)}
          >
            {endpoint.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(endpoint.volume * 100)}
            onChange={(e) => setVolume(endpoint.id, Number(e.target.value) / 100)}
          />
          <span className="ep-vol mono">{Math.round(endpoint.volume * 100)}%</span>
          {!endpoint.isDefault && (
            <button type="button" className="btn ghost small" onClick={() => void setDefault(endpoint.id)}>
              <Check size={12} /> Default
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function RoutingCard(): React.JSX.Element {
  const routes = useAudio((s) => s.routes)
  const webInputs = useAudio((s) => s.webInputs)
  const webOutputs = useAudio((s) => s.webOutputs)
  const activeRoutes = useAudio((s) => s.activeRoutes)
  const routeErrors = useAudio((s) => s.routeErrors)
  const addRoute = useAudio((s) => s.addRoute)
  const removeRoute = useAudio((s) => s.removeRoute)
  const toggleRoute = useAudio((s) => s.toggleRoute)
  const setRouteGain = useAudio((s) => s.setRouteGain)
  const refreshWebDevices = useAudio((s) => s.refreshWebDevices)

  const [sourceId, setSourceId] = useState('')
  const [sinkId, setSinkId] = useState('')

  const sourceOptions = [{ deviceId: SYSTEM_AUDIO_SOURCE, label: 'System audio (default output loopback)' }, ...webInputs]

  const add = (): void => {
    const source = sourceOptions.find((d) => d.deviceId === sourceId)
    const sink = webOutputs.find((d) => d.deviceId === sinkId)
    if (!source || !sink) return
    void addRoute(source.deviceId, source.label, sink.deviceId, sink.label)
  }

  return (
    <Card
      icon={Waves}
      title="Audio routing"
      subtitle="Pump any input or the system mix into any output - routes run while the app is open"
      actions={
        <button type="button" className="btn ghost small" onClick={() => void refreshWebDevices()}>
          <RefreshCw size={13} /> Rescan devices
        </button>
      }
    >
      <div className="route-add">
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">Select source…</option>
          {sourceOptions.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        <ArrowRight size={15} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <select value={sinkId} onChange={(e) => setSinkId(e.target.value)}>
          <option value="">Select output…</option>
          {webOutputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn primary small" disabled={!sourceId || !sinkId} onClick={add}>
          <Plus size={13} /> Add route
        </button>
      </div>

      <div className="route-list">
        {routes.map((route) => (
          <div key={route.id} className={`route-row ${activeRoutes.has(route.id) ? 'active' : ''}`}>
            <Toggle checked={route.enabled} onChange={(v) => void toggleRoute(route.id, v)} />
            <div className="route-main">
              <div className="route-path">
                <span className="route-ep" title={route.sourceLabel}>
                  {route.sourceId === SYSTEM_AUDIO_SOURCE ? <AudioLines size={12} /> : <Mic size={12} />}
                  {route.sourceLabel}
                </span>
                <ArrowRight size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                <span className="route-ep" title={route.sinkLabel}>
                  <Volume2 size={12} />
                  {route.sinkLabel}
                </span>
              </div>
              <div className="route-controls">
                <span className="faint" style={{ fontSize: 11 }}>
                  Gain
                </span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={Math.round(route.gain * 100)}
                  onChange={(e) => setRouteGain(route.id, Number(e.target.value) / 100)}
                />
                <span className="ep-vol mono">{Math.round(route.gain * 100)}%</span>
                <RouteMeter routeId={route.id} active={activeRoutes.has(route.id)} />
              </div>
              {routeErrors[route.id] && <div className="route-error">{routeErrors[route.id]}</div>}
            </div>
            <button
              type="button"
              className="btn ghost small icon-only"
              aria-label="Remove route"
              onClick={() => void removeRoute(route.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {routes.length === 0 && <div className="faint">No routes yet - add one above.</div>}
      </div>

      <div className="banner info" style={{ marginTop: 12 }}>
        <Info size={15} />
        <span>
          <strong>Mic → speaker:</strong> pick a microphone and an output. <strong>Speaker → speaker:</strong> use{' '}
          <em>System audio</em> as the source. <strong>Speaker → mic:</strong> route into{' '}
          <em>Speakers (Virtual Audio Driver)</em> - apps then hear it on the matching virtual microphone.
        </span>
      </div>
    </Card>
  )
}

function RouteMeter(props: { routeId: string; active: boolean }): React.JSX.Element {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!props.active) return
    let raf = 0
    const tick = (): void => {
      if (barRef.current) {
        barRef.current.style.width = `${Math.round(audioRouter.level(props.routeId) * 100)}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [props.routeId, props.active])

  return (
    <div className={`route-meter ${props.active ? '' : 'idle'}`}>
      <div ref={barRef} className="route-meter-fill" />
    </div>
  )
}
