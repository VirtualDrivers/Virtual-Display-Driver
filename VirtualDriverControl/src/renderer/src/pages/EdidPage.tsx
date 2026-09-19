import { useRef, useState } from 'react'
import {
  BadgeCheck,
  BadgeX,
  FileDown,
  FileUp,
  Fingerprint,
  FolderOpen,
  MonitorCheck,
  ScanEye,
  ShieldCheck,
  Workflow
} from 'lucide-react'
import { generateMonitorProfileXml, parseEdid } from '@shared/edid'
import type { ParsedEdid } from '@shared/types'
import { CieDiagram } from '@renderer/components/CieDiagram'
import { Card, Field, Toggle } from '@renderer/components/ui'
import { useDriver } from '@renderer/stores/driver'
import { useSettings } from '@renderer/stores/settings'
import { useUi } from '@renderer/stores/ui'

const SOURCE_LABEL: Record<string, string> = {
  detailed: 'Detailed (DTD)',
  'cea-vic': 'CEA-861 VIC',
  standard: 'Standard',
  established: 'Established'
}

export function EdidPage(): React.JSX.Element {
  const [edid, setEdid] = useState<ParsedEdid | null>(null)
  const [fileName, setFileName] = useState('')
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [exporting, setExporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const draft = useSettings((s) => s.draft)
  const patch = useSettings((s) => s.patch)
  const busy = useDriver((s) => s.busy)
  const quickToggle = useDriver((s) => s.quickToggle)
  const toast = useUi((s) => s.toast)

  const loadFile = async (file: File): Promise<void> => {
    if (file.size > 4096) {
      toast('warning', 'Not an EDID file', 'EDID blobs are at most a few hundred bytes.')
      return
    }
    const buffer = new Uint8Array(await file.arrayBuffer())
    const parsed = parseEdid(buffer)
    setBytes(buffer)
    setEdid(parsed)
    setFileName(file.name)
    if (!parsed.valid && parsed.errors.length > 0) {
      toast('error', 'EDID parse failed', parsed.errors[0])
    } else {
      toast('success', 'EDID decoded', `${parsed.timings.length} display modes found`)
    }
  }

  const exportProfile = async (): Promise<void> => {
    if (!edid || !bytes) return
    setExporting(true)
    try {
      const xml = generateMonitorProfileXml(edid)
      const result = await window.vdd.settings.saveMonitorProfile(xml, bytes)
      if (result.ok) {
        patch((d) => {
          d.edidIntegration.enabled = true
          d.edidIntegration.autoConfigureFromEdid = true
        })
        toast('success', 'Monitor profile exported', 'monitor_profile.xml + user_edid.bin written. EDID integration enabled in the draft - save to persist.')
      } else {
        toast('error', 'Export failed', result.error)
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">EDID Lab</h1>
          <p className="page-subtitle">Decode real monitor EDIDs and teach your virtual displays to impersonate them</p>
        </div>
      </div>

      <Card icon={ScanEye} title="EDID decoder" subtitle="Drop a .bin / .edid / .dat blob captured from a physical monitor">
        <input
          ref={fileInput}
          type="file"
          accept=".bin,.edid,.dat,.raw"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void loadFile(file)
            e.target.value = ''
          }}
        />
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file) void loadFile(file)
          }}
        >
          <FileUp size={28} strokeWidth={1.6} />
          <div style={{ fontWeight: 600 }}>{fileName || 'Drop an EDID binary here'}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            {fileName ? 'Drop another file to replace' : 'or click to browse - 128/256/512 byte blobs supported'}
          </div>
        </div>
      </Card>

      {edid && (
        <>
          <div className="card-grid two">
            <Card icon={Fingerprint} title="Identity" subtitle={fileName}>
              <table className="data-table">
                <tbody>
                  <tr>
                    <td>Monitor name</td>
                    <td>{edid.displayName ?? '—'}</td>
                  </tr>
                  <tr>
                    <td>Manufacturer</td>
                    <td className="mono">
                      {edid.manufacturerId} · product {edid.productCode.toString(16).toUpperCase().padStart(4, '0')}h
                    </td>
                  </tr>
                  <tr>
                    <td>Serial</td>
                    <td className="mono">{edid.serialString ?? edid.serialNumber}</td>
                  </tr>
                  <tr>
                    <td>Manufactured</td>
                    <td>
                      {edid.manufactureYear}
                      {edid.manufactureWeek > 0 && edid.manufactureWeek <= 54 ? `, week ${edid.manufactureWeek}` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td>EDID version</td>
                    <td>
                      {edid.edidVersion} · {edid.extensionCount} extension block{edid.extensionCount === 1 ? '' : 's'}
                    </td>
                  </tr>
                  <tr>
                    <td>Interface</td>
                    <td>
                      {edid.digital ? `Digital (${edid.videoInterface ?? 'unknown'})` : 'Analog'}
                      {edid.bitDepth ? ` · ${edid.bitDepth}-bit` : ''}
                    </td>
                  </tr>
                  {edid.screenWidthCm && edid.screenHeightCm && (
                    <tr>
                      <td>Physical size</td>
                      <td>
                        {edid.screenWidthCm}×{edid.screenHeightCm} cm (
                        {(Math.hypot(edid.screenWidthCm, edid.screenHeightCm) / 2.54).toFixed(1)}″)
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td>Gamma</td>
                    <td>{edid.gamma?.toFixed(2) ?? '—'}</td>
                  </tr>
                  <tr>
                    <td>Checksum</td>
                    <td>
                      {edid.checksumOk ? (
                        <span className="badge ok">
                          <BadgeCheck size={11} /> valid
                        </span>
                      ) : (
                        <span className="badge err">
                          <BadgeX size={11} /> invalid
                        </span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="row wrap" style={{ marginTop: 12, gap: 7 }}>
                {edid.hasCeaExtension && <span className="badge neutral">CEA-861</span>}
                {edid.ceaBasicAudio && <span className="badge neutral">Audio</span>}
                {edid.ceaYcbcr444 && <span className="badge neutral">YCbCr 4:4:4</span>}
                {edid.ceaYcbcr422 && <span className="badge neutral">YCbCr 4:2:2</span>}
                {edid.hdr?.eotfPq && <span className="badge ok">HDR10 (PQ)</span>}
                {edid.hdr?.eotfHlg && <span className="badge ok">HLG</span>}
                {edid.hdr?.maxLuminance && <span className="badge neutral">{edid.hdr.maxLuminance} nits peak</span>}
              </div>
            </Card>

            <Card icon={Workflow} title="Measured gamut" subtitle="Chromaticity coordinates embedded in the EDID">
              {edid.chromaticity ? (
                <CieDiagram value={edid.chromaticity} onChange={() => undefined} disabled width={320} />
              ) : (
                <span className="faint">No chromaticity data</span>
              )}
            </Card>
          </div>

          <Card
            icon={MonitorCheck}
            title={`Display modes (${edid.timings.length})`}
            subtitle={edid.preferred ? `Preferred: ${edid.preferred.width}×${edid.preferred.height} @ ${edid.preferred.refreshHz.toFixed(2)} Hz` : undefined}
            actions={
              <button type="button" className="btn primary small" disabled={exporting} onClick={() => void exportProfile()}>
                <FileDown size={13} />
                Export profile + EDID
              </button>
            }
          >
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Resolution</th>
                    <th>Refresh</th>
                    <th>Source</th>
                    <th>Pixel clock</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {edid.timings.map((t, i) => (
                    <tr key={i}>
                      <td className="mono">
                        {t.width}×{t.height}
                        {t.interlaced ? 'i' : ''}
                      </td>
                      <td className="mono">{t.refreshHz.toFixed(t.refreshHz % 1 === 0 ? 0 : 3)} Hz</td>
                      <td>
                        {SOURCE_LABEL[t.source]}
                        {t.vic ? ` ${t.vic}` : ''}
                      </td>
                      <td className="mono">{t.pixelClockMHz ? `${t.pixelClockMHz.toFixed(2)} MHz` : '—'}</td>
                      <td>{t === edid.preferred && <span className="badge ok">preferred</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <div className="card-grid two">
        <Card
          icon={ShieldCheck}
          title="EDID identity controls"
          subtitle="Applied live through the driver pipe when online"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <Toggle
              checked={draft.edid.customEdid}
              disabled={busy !== null}
              onChange={(v) => void quickToggle('CUSTOMEDID', v, 'Custom EDID')}
              label="Use custom EDID"
              sublabel="Serve user_edid.bin to Windows instead of the built-in identity"
            />
            <Toggle
              checked={draft.edid.preventSpoof}
              disabled={busy !== null}
              onChange={(v) => void quickToggle('PREVENTSPOOF', v, 'Prevent spoof')}
              label="Prevent manufacturer spoofing"
              sublabel="Keep the original manufacturer ID in the served EDID"
            />
            <Toggle
              checked={draft.edid.edidCeaOverride}
              disabled={busy !== null}
              onChange={(v) => void quickToggle('CEAOVERRIDE', v, 'CEA override')}
              label="CEA extension override"
              sublabel="Replace the CEA-861 block with driver-generated data"
            />
          </div>
        </Card>

        <Card
          icon={FolderOpen}
          title="EDID integration"
          subtitle="Auto-configure the driver from monitor_profile.xml"
          actions={
            <button type="button" className="btn ghost small" onClick={() => void window.vdd.system.openPath('edid')}>
              <FolderOpen size={13} /> Open folder
            </button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <Toggle
              checked={draft.edidIntegration.enabled}
              onChange={(v) => patch((d) => (d.edidIntegration.enabled = v))}
              label="Enable EDID integration"
            />
            <Toggle
              checked={draft.edidIntegration.autoConfigureFromEdid}
              onChange={(v) => patch((d) => (d.edidIntegration.autoConfigureFromEdid = v))}
              label="Auto-configure from profile"
              sublabel="Resolutions, color and HDR come from the profile"
            />
            <Toggle
              checked={draft.edidIntegration.overrideManualSettings}
              onChange={(v) => patch((d) => (d.edidIntegration.overrideManualSettings = v))}
              label="Profile overrides manual settings"
            />
            <Toggle
              checked={draft.edidIntegration.fallbackOnError}
              onChange={(v) => patch((d) => (d.edidIntegration.fallbackOnError = v))}
              label="Fall back to manual settings on error"
            />
            <Field label="Profile path" hint="Relative to the driver folder">
              <input
                type="text"
                value={draft.edidIntegration.edidProfilePath}
                onChange={(e) => patch((d) => (d.edidIntegration.edidProfilePath = e.target.value))}
              />
            </Field>
          </div>
        </Card>
      </div>
    </div>
  )
}
