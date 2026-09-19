import { useEffect } from 'react'
import { Cpu, Gpu, Loader2, RefreshCw, Zap } from 'lucide-react'
import { Card } from '@renderer/components/ui'
import { useDriver } from '@renderer/stores/driver'
import { useSettings } from '@renderer/stores/settings'
import { useUi } from '@renderer/stores/ui'

export function GpuPage(): React.JSX.Element {
  const gpus = useDriver((s) => s.gpus)
  const gpusLoading = useDriver((s) => s.gpusLoading)
  const refreshGpus = useDriver((s) => s.refreshGpus)
  const assignGpu = useDriver((s) => s.assignGpu)
  const busy = useDriver((s) => s.busy)
  const online = useDriver((s) => s.status?.pipeConnected === true)
  const assignedName = useSettings((s) => s.draft.gpu.friendlyName)
  const setPage = useUi((s) => s.setPage)

  useEffect(() => {
    if (gpus.length === 0) void refreshGpus()
  }, [gpus.length, refreshGpus])

  const isDefault = assignedName.trim().toLowerCase() === 'default'

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">GPU</h1>
          <p className="page-subtitle">Choose which adapter renders your virtual displays</p>
        </div>
        <button type="button" className="btn small" disabled={gpusLoading} onClick={() => void refreshGpus()}>
          {gpusLoading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          Rescan
        </button>
      </div>

      {!online && (
        <div className="banner info">
          <Cpu size={15} />
          Driver offline - adapters listed from Windows (WMI). Assignments are staged into the draft configuration.
        </div>
      )}

      <Card
        icon={Gpu}
        title="Available adapters"
        subtitle={online ? 'Enumerated by the driver via GETALLGPUS' : 'Enumerated via WMI'}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className={`gpu-card ${isDefault ? 'assigned' : ''}`}>
            <span className="gpu-icon">
              <Zap size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 620 }}>System default</div>
              <div className="faint" style={{ fontSize: 12 }}>
                Let Windows pick the adapter (recommended for single-GPU systems)
              </div>
            </div>
            {isDefault ? (
              <span className="badge ok">assigned</span>
            ) : (
              <button type="button" className="btn small" disabled={busy !== null} onClick={() => void assignGpu('default')}>
                Assign
              </button>
            )}
          </div>

          {gpus.map((gpu) => {
            const assigned = !isDefault && (gpu.assigned || gpu.name.toLowerCase() === assignedName.toLowerCase())
            return (
              <div key={gpu.name} className={`gpu-card ${assigned ? 'assigned' : ''}`}>
                <span className="gpu-icon">
                  <Gpu size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gpu.name}</div>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {gpu.source === 'pipe' ? 'Reported by driver' : 'Reported by Windows'}
                    {gpu.driverVersion ? ` · driver ${gpu.driverVersion}` : ''}
                    {gpu.vramMB ? ` · ${(gpu.vramMB / 1024).toFixed(1)} GB VRAM` : ''}
                  </div>
                </div>
                {assigned ? (
                  <span className="badge ok">assigned</span>
                ) : (
                  <button type="button" className="btn small" disabled={busy !== null} onClick={() => void assignGpu(gpu.name)}>
                    Assign
                  </button>
                )}
              </div>
            )
          })}

          {gpus.length === 0 && !gpusLoading && <span className="faint">No adapters found.</span>}
        </div>
      </Card>

      <Card icon={Cpu} title="Diagnostics" subtitle="Query the driver directly - results stream to the console">
        <div className="row wrap">
          <button
            type="button"
            className="btn small"
            disabled={!online}
            onClick={() => {
              void window.vdd.pipe.query('D3DDEVICEGPU')
              setPage('console')
            }}
          >
            D3D device info
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!online}
            onClick={() => {
              void window.vdd.pipe.query('GETASSIGNEDGPU')
              setPage('console')
            }}
          >
            Assigned GPU
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!online}
            onClick={() => {
              void window.vdd.pipe.query('IDDCXVERSION')
              setPage('console')
            }}
          >
            IddCx version
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!online}
            onClick={() => {
              void window.vdd.pipe.query('GETALLGPUS')
              setPage('console')
            }}
          >
            All GPUs
          </button>
        </div>
      </Card>
    </div>
  )
}
