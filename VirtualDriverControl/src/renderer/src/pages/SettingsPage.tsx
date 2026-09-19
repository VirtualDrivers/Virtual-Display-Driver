import { useCallback, useEffect, useState } from 'react'
import {
  Archive,
  FileCode2,
  FileText,
  FolderOpen,
  History,
  MousePointer2,
  Paintbrush,
  RotateCcw,
  Wand2
} from 'lucide-react'
import { DEFAULT_BASE_DIR, type BackupInfo } from '@shared/types'
import { Card, Field, Modal, NumberField, Segmented, Toggle } from '@renderer/components/ui'
import { useSettings } from '@renderer/stores/settings'
import { useUi } from '@renderer/stores/ui'
import { compactDiff, diffLines } from '@renderer/utils/diff'

const ACCENT_PRESETS = ['#4cc2ff', '#36c98e', '#9b7bff', '#f0a04c', '#e96bb0', '#f0566a', '#4dd4d4']

export function SettingsPage(): React.JSX.Element {
  const draft = useSettings((s) => s.draft)
  const dirty = useSettings((s) => s.dirty)
  const patch = useSettings((s) => s.patch)
  const load = useSettings((s) => s.load)
  const prefs = useUi((s) => s.prefs)
  const updatePrefs = useUi((s) => s.updatePrefs)
  const toast = useUi((s) => s.toast)

  const [xmlOpen, setXmlOpen] = useState(false)
  const [diff, setDiff] = useState<ReturnType<typeof compactDiff> | null>(null)
  const [rawXml, setRawXml] = useState('')
  const [backups, setBackups] = useState<BackupInfo[]>([])

  const refreshBackups = useCallback(async () => {
    setBackups(await window.vdd.settings.backups())
  }, [])

  useEffect(() => {
    void refreshBackups()
  }, [refreshBackups])

  const openXmlPreview = async (): Promise<void> => {
    const [current, preview] = await Promise.all([window.vdd.settings.raw(), window.vdd.settings.preview(draft)])
    setRawXml(preview)
    setDiff(dirty || current === null ? compactDiff(diffLines(current ?? '', preview)) : null)
    setXmlOpen(true)
  }

  const restoreBackup = async (backup: BackupInfo): Promise<void> => {
    const result = await window.vdd.settings.restore(backup.fileName)
    if (result.ok) {
      await load()
      await refreshBackups()
      toast('success', 'Backup restored', `${backup.fileName} is now the active configuration. Apply to reload the driver.`)
    } else {
      toast('error', 'Restore failed', result.error)
    }
  }

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Driver behavior, configuration file management and app preferences</p>
        </div>
      </div>

      <div className="card-grid two">
        <Card icon={MousePointer2} title="Cursor">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <Toggle
              checked={draft.cursor.hardwareCursor}
              onChange={(v) => patch((d) => (d.cursor.hardwareCursor = v))}
              label="Hardware cursor"
              sublabel="Composite the cursor on the GPU (recommended)"
            />
            <Toggle
              checked={draft.cursor.alphaCursorSupport}
              onChange={(v) => patch((d) => (d.cursor.alphaCursorSupport = v))}
              label="Alpha-blended cursor"
            />
            <div className="grid-2">
              <NumberField
                label="Max cursor width"
                value={draft.cursor.cursorMaxX}
                min={16}
                max={512}
                onChange={(v) => patch((d) => (d.cursor.cursorMaxX = v))}
              />
              <NumberField
                label="Max cursor height"
                value={draft.cursor.cursorMaxY}
                min={16}
                max={512}
                onChange={(v) => patch((d) => (d.cursor.cursorMaxY = v))}
              />
            </div>
            <Field label="XOR cursor support level" hint="Known upstream quirk: loaded by the driver but not applied">
              <Segmented
                value={String(draft.cursor.xorCursorSupportLevel) as '0' | '1' | '2'}
                options={[
                  { value: '0', label: 'None' },
                  { value: '1', label: 'Emulated' },
                  { value: '2', label: 'Full' }
                ]}
                onChange={(v) => patch((d) => (d.cursor.xorCursorSupportLevel = Number(v)))}
              />
            </Field>
          </div>
        </Card>

        <Card icon={FileText} title="Logging">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <Toggle
              checked={draft.logging.sendLogsThroughPipe}
              onChange={(v) => patch((d) => (d.logging.sendLogsThroughPipe = v))}
              label="Stream logs through pipe"
              sublabel="Lets this app capture live responses from the driver"
            />
            <Toggle
              checked={draft.logging.logging}
              onChange={(v) => patch((d) => (d.logging.logging = v))}
              label="File logging"
              sublabel="Daily log files in the Logs folder"
            />
            <Toggle
              checked={draft.logging.debugLogging}
              onChange={(v) => patch((d) => (d.logging.debugLogging = v))}
              label="Debug logging"
              sublabel="Warning: verbose - creates large files quickly"
            />
          </div>
        </Card>
      </div>

      <Card
        icon={Wand2}
        title="Auto resolutions"
        subtitle="Generate display modes from the EDID profile instead of the manual list"
        actions={<Toggle checked={draft.autoResolutions.enabled} onChange={(v) => patch((d) => (d.autoResolutions.enabled = v))} />}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 15,
            opacity: draft.autoResolutions.enabled ? 1 : 0.45,
            pointerEvents: draft.autoResolutions.enabled ? 'auto' : 'none'
          }}
        >
          <Field label="Source priority">
            <Segmented
              value={draft.autoResolutions.sourcePriority as 'manual' | 'edid' | 'combined'}
              options={[
                { value: 'manual', label: 'Manual list' },
                { value: 'edid', label: 'EDID modes' },
                { value: 'combined', label: 'Combined' }
              ]}
              onChange={(v) => patch((d) => (d.autoResolutions.sourcePriority = v))}
            />
          </Field>
          <div className="grid-4">
            <NumberField
              label="Min refresh (Hz)"
              value={draft.autoResolutions.edidModeFiltering.minRefreshRate}
              min={1}
              max={1000}
              onChange={(v) => patch((d) => (d.autoResolutions.edidModeFiltering.minRefreshRate = v))}
            />
            <NumberField
              label="Max refresh (Hz)"
              value={draft.autoResolutions.edidModeFiltering.maxRefreshRate}
              min={1}
              max={1000}
              onChange={(v) => patch((d) => (d.autoResolutions.edidModeFiltering.maxRefreshRate = v))}
            />
            <NumberField
              label="Min width"
              value={draft.autoResolutions.edidModeFiltering.minResolutionWidth}
              min={160}
              max={10240}
              onChange={(v) => patch((d) => (d.autoResolutions.edidModeFiltering.minResolutionWidth = v))}
            />
            <NumberField
              label="Max width"
              value={draft.autoResolutions.edidModeFiltering.maxResolutionWidth}
              min={160}
              max={10240}
              onChange={(v) => patch((d) => (d.autoResolutions.edidModeFiltering.maxResolutionWidth = v))}
            />
            <NumberField
              label="Min height"
              value={draft.autoResolutions.edidModeFiltering.minResolutionHeight}
              min={120}
              max={4320}
              onChange={(v) => patch((d) => (d.autoResolutions.edidModeFiltering.minResolutionHeight = v))}
            />
            <NumberField
              label="Max height"
              value={draft.autoResolutions.edidModeFiltering.maxResolutionHeight}
              min={120}
              max={4320}
              onChange={(v) => patch((d) => (d.autoResolutions.edidModeFiltering.maxResolutionHeight = v))}
            />
          </div>
          <Toggle
            checked={draft.autoResolutions.edidModeFiltering.excludeFractionalRates}
            onChange={(v) => patch((d) => (d.autoResolutions.edidModeFiltering.excludeFractionalRates = v))}
            label="Exclude fractional refresh rates"
            sublabel="Drop 59.94-style NTSC rates from generated modes"
          />
        </div>
      </Card>

      <Card
        icon={FileCode2}
        title="Configuration file"
        subtitle={`${prefs.baseDir}\\vdd_settings.xml`}
        actions={
          <>
            <button type="button" className="btn ghost small" onClick={() => void window.vdd.system.openPath('base')}>
              <FolderOpen size={13} /> Open folder
            </button>
            <button type="button" className="btn small" onClick={() => void openXmlPreview()}>
              <FileCode2 size={13} /> {dirty ? 'Preview changes' : 'View XML'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <History size={14} style={{ color: 'var(--text-faint)' }} />
            <span className="muted" style={{ fontWeight: 580 }}>
              Backups ({backups.length})
            </span>
            <span className="faint" style={{ fontSize: 12 }}>
              created automatically before every save
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 220, overflowY: 'auto' }}>
            {backups.map((backup) => (
              <div key={backup.fileName} className="backup-row">
                <Archive size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {backup.fileName}
                </span>
                <span className="faint">{new Date(backup.createdAt).toLocaleString()}</span>
                <button type="button" className="btn ghost small" onClick={() => void restoreBackup(backup)}>
                  <RotateCcw size={12} /> Restore
                </button>
              </div>
            ))}
            {backups.length === 0 && <span className="faint">No backups yet.</span>}
          </div>
        </div>
      </Card>

      <Card icon={Paintbrush} title="App preferences">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Theme">
            <Segmented
              value={prefs.theme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'System' }
              ]}
              onChange={(v) => void updatePrefs({ theme: v })}
            />
          </Field>
          <Field label="Accent color">
            <div className="row wrap" style={{ gap: 8 }}>
              {ACCENT_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Accent ${color}`}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: color,
                    border: prefs.accent === color ? '2px solid var(--text)' : '2px solid transparent',
                    boxShadow: prefs.accent === color ? `0 0 12px ${color}` : 'none'
                  }}
                  onClick={() => void updatePrefs({ accent: color })}
                />
              ))}
              <input type="color" value={prefs.accent} onChange={(e) => void updatePrefs({ accent: e.target.value })} />
            </div>
          </Field>
          <DriverFolderField />
        </div>
      </Card>

      <Modal
        open={xmlOpen}
        title={diff ? 'Pending changes to vdd_settings.xml' : 'vdd_settings.xml'}
        icon={FileCode2}
        onClose={() => setXmlOpen(false)}
        wide
        footer={
          <button type="button" className="btn ghost" onClick={() => setXmlOpen(false)}>
            Close
          </button>
        }
      >
        {diff ? (
          <div className="diff-view" style={{ maxHeight: '56vh' }}>
            {diff.map((line, idx) =>
              'count' in line ? (
                <div key={idx} className="diff-line ctx" style={{ opacity: 0.5, fontStyle: 'italic' }}>
                  <span className="gutter">⋯</span>
                  <span> {line.count} unchanged lines</span>
                </div>
              ) : (
                <div key={idx} className={`diff-line ${line.type}`}>
                  <span className="gutter">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''}</span>
                  <span>{line.text || ' '}</span>
                </div>
              )
            )}
          </div>
        ) : (
          <pre
            className="diff-view selectable-text"
            style={{ maxHeight: '56vh', padding: 14, whiteSpace: 'pre-wrap' }}
          >
            {rawXml}
          </pre>
        )}
      </Modal>
    </div>
  )
}

/**
 * Driver folder control. The app keeps the VDDPATH registry value (which the
 * driver reads its settings path from) and this preference in lockstep:
 * changes are written to the registry first and only applied once verified.
 */
function DriverFolderField(): React.JSX.Element {
  const prefs = useUi((s) => s.prefs)
  const setBaseDir = useUi((s) => s.setBaseDir)
  const toast = useUi((s) => s.toast)
  const load = useSettings((s) => s.load)

  const [value, setValue] = useState(prefs.baseDir)
  const [applying, setApplying] = useState(false)

  // Follow external changes (registry sync at startup, reset, etc.).
  useEffect(() => setValue(prefs.baseDir), [prefs.baseDir])

  const isDefault = prefs.baseDir.toLowerCase() === DEFAULT_BASE_DIR.toLowerCase()
  const edited = value.trim().length > 0 && value.trim().toLowerCase() !== prefs.baseDir.toLowerCase()

  const apply = async (target: string): Promise<void> => {
    setApplying(true)
    try {
      const result = await setBaseDir(target)
      if (result.ok) {
        await load()
        toast('success', 'Driver folder updated', `Registry and app now point at ${result.prefs.baseDir}. Restart the driver device to apply.`)
      } else {
        toast('error', 'Folder not changed', result.error)
      }
    } finally {
      setApplying(false)
    }
  }

  return (
    <Field
      label="Driver folder"
      hint={`The driver reads vdd_settings.xml from this folder (registry VDDPATH, default ${DEFAULT_BASE_DIR}). The app keeps both in sync automatically - changing it may prompt for elevation. Existing files are not moved.`}
    >
      <div className="row" style={{ gap: 8 }}>
        <input
          type="text"
          value={value}
          className="mono"
          style={{ flex: 1 }}
          disabled={applying}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && edited && void apply(value.trim())}
        />
        <button type="button" className="btn small primary" disabled={!edited || applying} onClick={() => void apply(value.trim())}>
          {applying ? 'Applying…' : 'Apply'}
        </button>
        {!isDefault && (
          <button type="button" className="btn ghost small" disabled={applying} onClick={() => void apply(DEFAULT_BASE_DIR)}>
            Reset to default
          </button>
        )}
      </div>
    </Field>
  )
}
