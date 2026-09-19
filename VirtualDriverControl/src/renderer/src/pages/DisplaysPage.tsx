import { useMemo, useState } from 'react'
import { Gauge, LayoutGrid, MonitorCog, Plus, Proportions, Star, Trash2, X } from 'lucide-react'
import { RESOLUTION_PRESETS, REFRESH_RATE_PRESETS, aspectRatioLabel } from '@shared/presets'
import { ArrangementMap } from '@renderer/components/ArrangementMap'
import { Card, Field, Modal, NumberField, Toggle } from '@renderer/components/ui'
import { useSettings } from '@renderer/stores/settings'
import { useUi } from '@renderer/stores/ui'

const STAGE_COLORS = ['#36c98e', '#58a6ff', '#f0b34c', '#e96bb0', '#9b7bff', '#4dd4d4', '#f0566a', '#a3d65c']

function formatRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(2).replace(/0$/, '')
}

export function DisplaysPage(): React.JSX.Element {
  const draft = useSettings((s) => s.draft)
  const patch = useSettings((s) => s.patch)
  const toast = useUi((s) => s.toast)

  const [newGlobalRate, setNewGlobalRate] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [customW, setCustomW] = useState(1920)
  const [customH, setCustomH] = useState(1080)

  const existing = useMemo(() => new Set(draft.resolutions.map((r) => `${r.width}x${r.height}`)), [draft.resolutions])

  const addResolution = (width: number, height: number): void => {
    if (width < 320 || height < 240 || width > 10240 || height > 4320) {
      toast('warning', 'Resolution out of range', 'Supported range is 320×240 to 10240×4320.')
      return
    }
    if (existing.has(`${width}x${height}`)) {
      toast('info', 'Already configured', `${width}×${height} is already in the list.`)
      return
    }
    patch((d) => {
      d.resolutions.push({ width, height, refreshRates: [60] })
      d.resolutions.sort((a, b) => b.width * b.height - a.width * a.height)
    })
  }

  const addGlobalRate = (): void => {
    const rate = Number(newGlobalRate)
    if (!Number.isFinite(rate) || rate < 1 || rate > 1000) return
    if (draft.global.refreshRates.includes(rate)) return
    patch((d) => {
      d.global.refreshRates.push(rate)
      d.global.refreshRates.sort((a, b) => a - b)
    })
    setNewGlobalRate('')
  }

  const sizeComparison = useMemo(() => {
    const maxW = Math.max(...draft.resolutions.map((r) => r.width), 1)
    const maxH = Math.max(...draft.resolutions.map((r) => r.height), 1)
    const scale = Math.min(420 / maxW, 190 / maxH)
    return draft.resolutions.map((r, i) => ({
      ...r,
      px: Math.round(r.width * scale),
      py: Math.round(r.height * scale),
      color: STAGE_COLORS[i % STAGE_COLORS.length]
    }))
  }, [draft.resolutions])

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">Displays</h1>
          <p className="page-subtitle">Resolutions and refresh rates offered by every virtual monitor</p>
        </div>
      </div>

      <ArrangementMap />

      <Card
        icon={Gauge}
        title="Global refresh rates"
        subtitle="Applied to every resolution in addition to its own rates"
      >
        <div className="row wrap" style={{ marginBottom: 12 }}>
          {draft.global.refreshRates.map((rate) => (
            <span key={rate} className="chip on">
              {formatRate(rate)} Hz
              <button
                type="button"
                className="chip-x"
                style={{ background: 'none', border: 'none', color: 'inherit' }}
                aria-label={`Remove ${rate} Hz`}
                onClick={() => patch((d) => (d.global.refreshRates = d.global.refreshRates.filter((r) => r !== rate)))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {draft.global.refreshRates.length === 0 && <span className="faint">No global rates - each resolution uses only its own.</span>}
        </div>
        <div className="row wrap">
          {REFRESH_RATE_PRESETS.filter((r) => !draft.global.refreshRates.includes(r)).map((rate) => (
            <button
              key={rate}
              type="button"
              className="chip selectable"
              style={{ background: 'transparent', font: 'inherit' }}
              onClick={() =>
                patch((d) => {
                  d.global.refreshRates.push(rate)
                  d.global.refreshRates.sort((a, b) => a - b)
                })
              }
            >
              <Plus size={11} /> {formatRate(rate)}
            </button>
          ))}
          <div className="row" style={{ gap: 6 }}>
            <input
              type="number"
              placeholder="Custom Hz"
              value={newGlobalRate}
              min={1}
              max={1000}
              style={{ width: 110 }}
              onChange={(e) => setNewGlobalRate(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addGlobalRate()}
            />
            <button type="button" className="btn small" onClick={addGlobalRate}>
              Add
            </button>
          </div>
        </div>
      </Card>

      <Card
        icon={MonitorCog}
        title="Resolutions"
        subtitle={`${draft.resolutions.length} mode profile${draft.resolutions.length === 1 ? '' : 's'} exposed to Windows`}
        actions={
          <button type="button" className="btn primary small" onClick={() => setAddOpen(true)}>
            <Plus size={13} /> Add resolution
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {draft.resolutions.map((res, index) => (
            <ResolutionRow key={`${res.width}x${res.height}`} index={index} />
          ))}
          {draft.resolutions.length === 0 && (
            <div className="banner warn">
              <LayoutGrid size={15} />
              At least one resolution is required for the driver to expose display modes.
            </div>
          )}
        </div>
      </Card>

      <div className="card-grid two">
        <Card icon={Star} title="Preferred mode" subtitle="The default mode Windows picks for new virtual displays">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Toggle
              checked={draft.autoResolutions.preferredMode.useEdidPreferred}
              onChange={(v) => patch((d) => (d.autoResolutions.preferredMode.useEdidPreferred = v))}
              label="Use EDID preferred mode"
              sublabel="Requires EDID integration with a monitor profile"
            />
            <div className="grid-3">
              <NumberField
                label="Fallback width"
                value={draft.autoResolutions.preferredMode.fallbackWidth}
                min={320}
                max={10240}
                onChange={(v) => patch((d) => (d.autoResolutions.preferredMode.fallbackWidth = v))}
              />
              <NumberField
                label="Fallback height"
                value={draft.autoResolutions.preferredMode.fallbackHeight}
                min={240}
                max={4320}
                onChange={(v) => patch((d) => (d.autoResolutions.preferredMode.fallbackHeight = v))}
              />
              <NumberField
                label="Refresh (Hz)"
                value={draft.autoResolutions.preferredMode.fallbackRefresh}
                min={1}
                max={1000}
                onChange={(v) => patch((d) => (d.autoResolutions.preferredMode.fallbackRefresh = v))}
              />
            </div>
          </div>
        </Card>

        <Card icon={Proportions} title="Size comparison" subtitle="Configured resolutions to scale">
          <div className="size-compare">
            {sizeComparison.map((r) => (
              <div
                key={`${r.width}x${r.height}`}
                className="sc-rect"
                style={{
                  width: r.px,
                  height: r.py,
                  borderColor: r.color,
                  background: `color-mix(in srgb, ${r.color} 7%, transparent)`,
                  zIndex: 10 - sizeComparison.indexOf(r)
                }}
              >
                <span className="sc-tag" style={{ color: r.color }}>
                  {r.width}×{r.height}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Modal
        open={addOpen}
        title="Add resolution"
        icon={MonitorCog}
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setAddOpen(false)}>
              Done
            </button>
          </>
        }
        wide
      >
        <div className="row" style={{ gap: 10, marginBottom: 18, alignItems: 'flex-end' }}>
          <Field label="Width">
            <input type="number" value={customW} min={320} max={10240} style={{ width: 120 }} onChange={(e) => setCustomW(Number(e.target.value))} />
          </Field>
          <span style={{ paddingBottom: 8, color: 'var(--text-faint)' }}>×</span>
          <Field label="Height">
            <input type="number" value={customH} min={240} max={4320} style={{ width: 120 }} onChange={(e) => setCustomH(Number(e.target.value))} />
          </Field>
          <button type="button" className="btn primary" onClick={() => addResolution(Math.floor(customW), Math.floor(customH))}>
            <Plus size={14} /> Add custom
          </button>
        </div>

        {(['HD', 'QHD', '4K & Beyond', 'Ultrawide', 'Standard', 'Portable & Tablet'] as const).map((category) => (
          <div key={category} style={{ marginBottom: 16 }}>
            <div className="nav-section" style={{ margin: '0 0 8px' }}>
              {category}
            </div>
            <div className="preset-grid">
              {RESOLUTION_PRESETS.filter((p) => p.category === category).map((preset) => (
                <button
                  key={`${preset.width}x${preset.height}`}
                  type="button"
                  className="preset-card"
                  disabled={existing.has(`${preset.width}x${preset.height}`)}
                  onClick={() => addResolution(preset.width, preset.height)}
                >
                  <div className="p-dim">
                    {preset.width}×{preset.height}
                  </div>
                  <div className="p-label">
                    {preset.label} · {aspectRatioLabel(preset.width, preset.height)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </Modal>
    </div>
  )
}

function ResolutionRow(props: { index: number }): React.JSX.Element | null {
  const res = useSettings((s) => s.draft.resolutions[props.index])
  const patch = useSettings((s) => s.patch)
  const [newRate, setNewRate] = useState('')

  if (!res) return null

  const addRate = (): void => {
    const rate = Number(newRate)
    if (!Number.isFinite(rate) || rate < 1 || rate > 1000 || res.refreshRates.includes(rate)) return
    patch((d) => {
      d.resolutions[props.index].refreshRates.push(rate)
      d.resolutions[props.index].refreshRates.sort((a, b) => a - b)
    })
    setNewRate('')
  }

  return (
    <div className="res-row">
      <span className="res-dim">
        {res.width}×{res.height}
      </span>
      <span className="res-aspect">{aspectRatioLabel(res.width, res.height)}</span>
      <div className="res-rates">
        {res.refreshRates.map((rate) => (
          <span key={rate} className="chip">
            {formatRate(rate)} Hz
            <button
              type="button"
              className="chip-x"
              style={{ background: 'none', border: 'none', color: 'inherit' }}
              aria-label={`Remove ${rate} Hz`}
              onClick={() =>
                patch((d) => {
                  const target = d.resolutions[props.index]
                  if (target.refreshRates.length > 1) {
                    target.refreshRates = target.refreshRates.filter((r) => r !== rate)
                  }
                })
              }
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          type="number"
          placeholder="+Hz"
          value={newRate}
          style={{ width: 64, padding: '3px 8px', fontSize: 12 }}
          onChange={(e) => setNewRate(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addRate()}
          onBlur={() => newRate && addRate()}
        />
      </div>
      <button
        type="button"
        className="btn ghost small icon-only"
        aria-label="Remove resolution"
        onClick={() => patch((d) => d.resolutions.splice(props.index, 1))}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
