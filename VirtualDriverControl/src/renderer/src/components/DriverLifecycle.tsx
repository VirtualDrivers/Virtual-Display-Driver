import { useEffect, useState } from 'react'
import {
  ArrowUpCircle,
  Download,
  ExternalLink,
  Layers,
  Loader2,
  PackageCheck,
  PackageOpen,
  Power,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type { ManagedDriverId } from '@shared/types'
import { Card, Segmented } from '@renderer/components/ui'
import { useDriver } from '@renderer/stores/driver'
import { useInstaller } from '@renderer/stores/installer'

const TITLES: Record<ManagedDriverId, string> = {
  display: 'Display driver lifecycle',
  audio: 'Audio driver lifecycle'
}

const REPOS: Record<ManagedDriverId, string> = {
  display: 'VirtualDrivers/Virtual-Display-Driver',
  audio: 'VirtualDrivers/Virtual-Audio-Driver'
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString()
}

export function DriverLifecycle(props: { driver: ManagedDriverId }): React.JSX.Element {
  const { driver } = props
  const multiInstance = driver === 'audio'

  const state = useInstaller((s) => s.drivers[driver])
  const working = useInstaller((s) => s.working)
  const progress = useInstaller((s) => s.progress)
  const init = useInstaller((s) => s.init)
  const checkLatest = useInstaller((s) => s.checkLatest)
  const install = useInstaller((s) => s.install)
  const uninstallDriver = useInstaller((s) => s.uninstallDriver)
  const restartDevice = useInstaller((s) => s.restartDevice)
  const setInstances = useInstaller((s) => s.setInstances)
  const testSigning = useInstaller((s) => s.testSigning)
  const setTestSigning = useInstaller((s) => s.setTestSigning)
  const displayStatus = useDriver((s) => s.status)

  const [instanceChoice, setInstanceChoice] = useState<number | null>(null)

  useEffect(() => {
    init()
    if (!useInstaller.getState().drivers[driver].latest && !useInstaller.getState().drivers[driver].checking) {
      void checkLatest(driver)
    }
  }, [init, checkLatest, driver])

  const { latest, installedTag, device, checking, checkError } = state
  const installed = (device?.count ?? 0) > 0
  const updateAvailable = installed && latest !== null && installedTag !== null && latest.tag !== installedTag
  const busy = working !== null
  const busyHere = working?.driver === driver
  const deviceCount = device?.count ?? 0
  const selectedInstances = instanceChoice ?? Math.max(deviceCount, 1)

  const installLabel = !installed
    ? latest
      ? `Download & install ${latest.tag}`
      : 'Download & install latest'
    : updateAvailable
      ? `Update to ${latest?.tag}`
      : 'Reinstall latest'

  const installedDetail = (): string => {
    if (!installed) return 'No device on this system'
    const statuses = device?.statuses.join(', ') ?? ''
    if (driver === 'display') {
      return displayStatus?.dllDate ? `MttVDD.dll · ${displayStatus.dllDate}` : `device status ${statuses}`
    }
    return `${deviceCount} device${deviceCount === 1 ? '' : 's'} · status ${statuses}`
  }

  return (
    <Card
      icon={PackageOpen}
      title={TITLES[driver]}
      subtitle={`Official packages from ${REPOS[driver]} - downloads are checksum-verified`}
      actions={
        <button type="button" className="btn ghost small" disabled={checking || busy} onClick={() => void checkLatest(driver)}>
          {checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Check for updates
        </button>
      }
    >
      <div className="lifecycle-grid">
        <div className="lifecycle-block">
          <span className="stat-label">
            <PackageCheck size={11} /> Installed
          </span>
          <span className="stat-value" style={{ color: installed ? 'var(--success)' : 'var(--danger)' }}>
            {installed ? installedTag ?? 'Installed' : 'Not installed'}
          </span>
          <span className="stat-sub">{installedDetail()}</span>
        </div>

        <div className="lifecycle-block">
          <span className="stat-label">
            <Download size={11} /> Latest release
          </span>
          <span className="stat-value">{checking ? 'Checking…' : latest?.tag ?? '—'}</span>
          <span className="stat-sub">
            {checkError
              ? `Check failed: ${checkError}`
              : latest
                ? `${formatDate(latest.publishedAt)}${latest.asset ? ` · ${latest.asset.name} (${formatSize(latest.asset.sizeBytes)})` : ' · no driver package'}`
                : 'Fetching from GitHub…'}
          </span>
          {latest && (
            <button
              type="button"
              className="btn ghost small"
              style={{ padding: '1px 6px', marginLeft: -6, alignSelf: 'flex-start' }}
              onClick={() => void window.vdd.system.openExternal(latest.htmlUrl)}
            >
              Release notes <ExternalLink size={11} />
            </button>
          )}
        </div>
      </div>

      {driver === 'audio' && (
        <div className={`banner ${testSigning === true ? 'info' : 'warn'}`} style={{ marginTop: 12 }}>
          {testSigning === true ? <ShieldCheck size={16} style={{ flexShrink: 0 }} /> : <ShieldAlert size={16} style={{ flexShrink: 0 }} />}
          <span style={{ flex: 1 }}>
            The Virtual Audio Driver is currently <strong>test-signed</strong>, so Windows must run in{' '}
            <strong>Test Signing mode</strong> for the device to start.{' '}
            {testSigning === true && 'Test signing is enabled in this PC\u2019s boot configuration.'}
            {testSigning === false && 'Test signing is currently OFF on this PC.'}
            {testSigning === null && 'The current test signing state could not be determined.'}
            {testSigning !== null && ' Changes take effect after a Windows restart. Secure Boot must be disabled to enable it.'}
          </span>
          {testSigning !== null && (
            <button
              type="button"
              className="btn small"
              style={{ flexShrink: 0 }}
              disabled={busy}
              onClick={() => void setTestSigning(!testSigning)}
            >
              {busyHere && working?.op === 'testsigning' ? (
                <Loader2 size={13} className="spin" />
              ) : testSigning ? (
                <ShieldAlert size={13} />
              ) : (
                <ShieldCheck size={13} />
              )}
              {busyHere && working?.op === 'testsigning'
                ? 'Applying…'
                : testSigning
                  ? 'Disable test signing'
                  : 'Enable test signing'}
            </button>
          )}
        </div>
      )}

      {busyHere && progress && (
        <div className="lifecycle-progress">
          <div className="progress-track">
            <div
              className={`progress-fill ${progress.percent < 0 ? 'indeterminate' : ''}`}
              style={progress.percent >= 0 ? { width: `${progress.percent}%` } : undefined}
            />
          </div>
          <span className="progress-message">{progress.message}</span>
        </div>
      )}

      <div className="lifecycle-actions">
        <button
          type="button"
          className={`btn small ${!installed || updateAvailable ? 'primary' : ''}`}
          disabled={busy || checking || (latest !== null && latest.asset === null)}
          onClick={() => void install(driver, multiInstance ? selectedInstances : undefined)}
        >
          {busyHere && working?.op === 'install' ? (
            <Loader2 size={13} className="spin" />
          ) : updateAvailable ? (
            <ArrowUpCircle size={13} />
          ) : (
            <Download size={13} />
          )}
          {busyHere && working?.op === 'install' ? 'Installing…' : installLabel}
        </button>
        {installed && (
          <>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => void restartDevice(driver)}>
              {busyHere && working?.op === 'restart' ? <Loader2 size={13} className="spin" /> : <Power size={13} />}
              {busyHere && working?.op === 'restart' ? 'Restarting…' : 'Restart device'}
            </button>
            <button type="button" className="btn ghost small danger" disabled={busy} onClick={() => void uninstallDriver(driver)}>
              {busyHere && working?.op === 'uninstall' ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
              {busyHere && working?.op === 'uninstall' ? 'Removing…' : 'Uninstall'}
            </button>
          </>
        )}
        {updateAvailable && (
          <span className="lifecycle-hint">
            Update available: {installedTag} → {latest?.tag}
          </span>
        )}
      </div>

      {multiInstance && (
        <div className="lifecycle-actions" style={{ marginTop: 10 }}>
          <span className="stat-label" style={{ marginRight: 2 }}>
            <Layers size={11} /> Devices
          </span>
          <Segmented
            value={String(selectedInstances)}
            options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => setInstanceChoice(Number(v))}
          />
          {installed && selectedInstances !== deviceCount && (
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => void setInstances(driver, selectedInstances)}
            >
              {busyHere && working?.op === 'instances' ? <Loader2 size={13} className="spin" /> : <Layers size={13} />}
              {busyHere && working?.op === 'instances' ? 'Applying…' : `Set ${selectedInstances} device${selectedInstances === 1 ? '' : 's'}`}
            </button>
          )}
          <span className="faint" style={{ fontSize: 11.5 }}>
            Each device adds an independent virtual speaker + microphone pair for routing.
          </span>
        </div>
      )}
    </Card>
  )
}
