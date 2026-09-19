import { Blend, Palette, Sparkles, SunMedium, Triangle } from 'lucide-react'
import { COLOR_SPACE_PRESETS } from '@shared/defaults'
import type { ColourFormat } from '@shared/types'
import { CieDiagram } from '@renderer/components/CieDiagram'
import { Card, Field, NumberField, Segmented, Toggle } from '@renderer/components/ui'
import { useSettings } from '@renderer/stores/settings'

const COLOUR_FORMATS: Array<{ value: ColourFormat; label: string; sub: string }> = [
  { value: 'RGB', label: 'RGB', sub: 'Full fidelity, default' },
  { value: 'YCbCr444', label: 'YCbCr 4:4:4', sub: 'No chroma subsampling' },
  { value: 'YCbCr422', label: 'YCbCr 4:2:2', sub: 'Half chroma bandwidth' },
  { value: 'YCbCr420', label: 'YCbCr 4:2:0', sub: 'Quarter chroma, streaming' }
]

export function ColorPage(): React.JSX.Element {
  const draft = useSettings((s) => s.draft)
  const patch = useSettings((s) => s.patch)

  const primaries = draft.hdrAdvanced.colorPrimaries
  const hdr10 = draft.hdrAdvanced.hdr10StaticMetadata
  const colorSpace = draft.hdrAdvanced.colorSpace

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">HDR & Color</h1>
          <p className="page-subtitle">Pixel format, HDR10 metadata and the color gamut your virtual displays advertise</p>
        </div>
      </div>

      <Card icon={Palette} title="Color format" subtitle="How pixels are encoded on the virtual link">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="row wrap" style={{ gap: 9 }}>
            {COLOUR_FORMATS.map((format) => (
              <button
                key={format.value}
                type="button"
                className="preset-card"
                style={{
                  borderColor: draft.colour.colourFormat === format.value ? 'var(--accent)' : undefined,
                  background: draft.colour.colourFormat === format.value ? 'var(--accent-softer)' : undefined,
                  minWidth: 150
                }}
                onClick={() => patch((d) => (d.colour.colourFormat = format.value))}
              >
                <div className="p-dim">{format.label}</div>
                <div className="p-label">{format.sub}</div>
              </button>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 26 }}>
            <Toggle
              checked={draft.colour.hdrPlus}
              onChange={(v) => patch((d) => (d.colour.hdrPlus = v))}
              label="HDR+"
              sublabel="Requires Windows 11 23H2+"
            />
            <Toggle
              checked={draft.colour.sdr10bit}
              onChange={(v) => patch((d) => (d.colour.sdr10bit = v))}
              label="SDR 10-bit"
              sublabel="10-bit output without HDR"
            />
          </div>
        </div>
      </Card>

      <Card
        icon={SunMedium}
        title="HDR10 static metadata"
        subtitle="Mastering display luminance advertised to HDR-aware apps"
        actions={<Toggle checked={hdr10.enabled} onChange={(v) => patch((d) => (d.hdrAdvanced.hdr10StaticMetadata.enabled = v))} />}
      >
        <div className="grid-4" style={{ opacity: hdr10.enabled ? 1 : 0.45, pointerEvents: hdr10.enabled ? 'auto' : 'none' }}>
          <NumberField
            label="Max mastering (nits)"
            value={hdr10.maxDisplayMasteringLuminance}
            min={100}
            max={10000}
            step={50}
            onChange={(v) => patch((d) => (d.hdrAdvanced.hdr10StaticMetadata.maxDisplayMasteringLuminance = v))}
          />
          <NumberField
            label="Min mastering (nits)"
            value={hdr10.minDisplayMasteringLuminance}
            min={0.0001}
            max={5}
            step={0.01}
            onChange={(v) => patch((d) => (d.hdrAdvanced.hdr10StaticMetadata.minDisplayMasteringLuminance = v))}
          />
          <NumberField
            label="MaxCLL (nits)"
            value={hdr10.maxContentLightLevel}
            min={100}
            max={10000}
            step={50}
            hint="Max content light level"
            onChange={(v) => patch((d) => (d.hdrAdvanced.hdr10StaticMetadata.maxContentLightLevel = v))}
          />
          <NumberField
            label="MaxFALL (nits)"
            value={hdr10.maxFrameAvgLightLevel}
            min={50}
            max={5000}
            step={50}
            hint="Max frame-average light level"
            onChange={(v) => patch((d) => (d.hdrAdvanced.hdr10StaticMetadata.maxFrameAvgLightLevel = v))}
          />
        </div>
      </Card>

      <Card
        icon={Triangle}
        title="Color primaries"
        subtitle="Drag the gamut your virtual display claims to cover - dashed triangle is sRGB"
        actions={<Toggle checked={primaries.enabled} onChange={(v) => patch((d) => (d.hdrAdvanced.colorPrimaries.enabled = v))} />}
      >
        <div className="row" style={{ alignItems: 'flex-start', gap: 26, flexWrap: 'wrap' }}>
          <CieDiagram
            value={primaries}
            disabled={!primaries.enabled}
            onChange={(p) =>
              patch((d) => {
                Object.assign(d.hdrAdvanced.colorPrimaries, p)
              })
            }
          />
          <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Preset gamut">
              <div className="row wrap" style={{ gap: 7 }}>
                {Object.entries(COLOR_SPACE_PRESETS).map(([name, preset]) => (
                  <button
                    key={name}
                    type="button"
                    className="chip selectable"
                    style={{ background: 'transparent', font: 'inherit' }}
                    disabled={!primaries.enabled}
                    onClick={() =>
                      patch((d) => {
                        Object.assign(d.hdrAdvanced.colorPrimaries, preset)
                      })
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
            </Field>
            <table className="data-table" style={{ opacity: primaries.enabled ? 1 : 0.5 }}>
              <thead>
                <tr>
                  <th>Primary</th>
                  <th>x</th>
                  <th>y</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ color: '#ff5d5d' }}>Red</td>
                  <td className="mono">{primaries.redX.toFixed(4)}</td>
                  <td className="mono">{primaries.redY.toFixed(4)}</td>
                </tr>
                <tr>
                  <td style={{ color: '#4ade80' }}>Green</td>
                  <td className="mono">{primaries.greenX.toFixed(4)}</td>
                  <td className="mono">{primaries.greenY.toFixed(4)}</td>
                </tr>
                <tr>
                  <td style={{ color: '#60a5fa' }}>Blue</td>
                  <td className="mono">{primaries.blueX.toFixed(4)}</td>
                  <td className="mono">{primaries.blueY.toFixed(4)}</td>
                </tr>
                <tr>
                  <td>White point</td>
                  <td className="mono">{primaries.whiteX.toFixed(4)}</td>
                  <td className="mono">{primaries.whiteY.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <div className="card-grid two">
        <Card
          icon={Blend}
          title="Color space & gamma"
          actions={<Toggle checked={colorSpace.enabled} onChange={(v) => patch((d) => (d.hdrAdvanced.colorSpace.enabled = v))} />}
        >
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: colorSpace.enabled ? 1 : 0.45, pointerEvents: colorSpace.enabled ? 'auto' : 'none' }}
          >
            <Field label={`Gamma correction: ${colorSpace.gammaCorrection.toFixed(2)}`}>
              <input
                type="range"
                min={1.0}
                max={3.0}
                step={0.05}
                value={colorSpace.gammaCorrection}
                onChange={(e) => patch((d) => (d.hdrAdvanced.colorSpace.gammaCorrection = Number(e.target.value)))}
              />
            </Field>
            <Field label="Primary color space">
              <select
                value={colorSpace.primaryColorSpace}
                onChange={(e) => patch((d) => (d.hdrAdvanced.colorSpace.primaryColorSpace = e.target.value))}
              >
                {['sRGB', 'DCI-P3', 'AdobeRGB', 'Rec2020', 'Rec709'].map((cs) => (
                  <option key={cs} value={cs}>
                    {cs}
                  </option>
                ))}
              </select>
            </Field>
            <Toggle
              checked={colorSpace.enableMatrixTransform}
              onChange={(v) => patch((d) => (d.hdrAdvanced.colorSpace.enableMatrixTransform = v))}
              label="Matrix transform"
              sublabel="Apply color space conversion matrix"
            />
          </div>
        </Card>

        <Card icon={Sparkles} title="Bit depth & SDR level">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Toggle
              checked={draft.colorAdvanced.bitDepthManagement.autoSelectFromColorSpace}
              onChange={(v) => patch((d) => (d.colorAdvanced.bitDepthManagement.autoSelectFromColorSpace = v))}
              label="Auto bit depth"
              sublabel="Derive bit depth from color space"
            />
            <Field label="Force bit depth">
              <Segmented
                value={String(draft.colorAdvanced.bitDepthManagement.forceBitDepth) as '8' | '10' | '12' | '16'}
                options={[
                  { value: '8', label: '8-bit' },
                  { value: '10', label: '10-bit' },
                  { value: '12', label: '12-bit' },
                  { value: '16', label: '16-bit' }
                ]}
                onChange={(v) => patch((d) => (d.colorAdvanced.bitDepthManagement.forceBitDepth = Number(v)))}
              />
            </Field>
            <Toggle
              checked={draft.colorAdvanced.bitDepthManagement.fp16SurfaceSupport}
              onChange={(v) => patch((d) => (d.colorAdvanced.bitDepthManagement.fp16SurfaceSupport = v))}
              label="FP16 surface support"
              sublabel="Keep enabled for compatibility"
            />
            <NumberField
              label="SDR white level (nits)"
              value={draft.colorAdvanced.colorFormatExtended.sdrWhiteLevel}
              min={40}
              max={480}
              step={10}
              onChange={(v) => patch((d) => (d.colorAdvanced.colorFormatExtended.sdrWhiteLevel = v))}
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
