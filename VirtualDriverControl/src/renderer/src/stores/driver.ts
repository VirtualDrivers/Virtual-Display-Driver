import { create } from 'zustand'
import type { DriverStatus, GpuInfo, PipeToggleCommand, SystemInfo } from '@shared/types'
import { useSettings } from './settings'
import { useUi } from './ui'

/** Maps pipe toggle commands to their vdd_settings.xml fields (for offline staging). */
const TOGGLE_PATCHES: Record<PipeToggleCommand, (draft: import('@shared/types').VddSettings, value: boolean) => void> = {
  HDRPLUS: (d, v) => (d.colour.hdrPlus = v),
  SDR10: (d, v) => (d.colour.sdr10bit = v),
  CUSTOMEDID: (d, v) => (d.edid.customEdid = v),
  PREVENTSPOOF: (d, v) => (d.edid.preventSpoof = v),
  CEAOVERRIDE: (d, v) => (d.edid.edidCeaOverride = v),
  HARDWARECURSOR: (d, v) => (d.cursor.hardwareCursor = v),
  LOGGING: (d, v) => (d.logging.logging = v),
  LOG_DEBUG: (d, v) => (d.logging.debugLogging = v)
}

interface DriverState {
  status: DriverStatus | null
  iddcx: string | null
  sysInfo: SystemInfo | null
  gpus: GpuInfo[]
  gpusLoading: boolean
  /** Set while a reload-triggering pipe operation is in flight. */
  busy: string | null
  init: () => Promise<void>
  refreshStatus: (force?: boolean) => Promise<void>
  refreshGpus: () => Promise<void>
  /** Apply a new virtual display count via SETDISPLAYCOUNT (or stage offline). */
  applyDisplayCount: (count: number) => Promise<void>
  /** Toggle a driver feature live via the pipe (or stage offline). */
  quickToggle: (name: PipeToggleCommand, value: boolean, label: string) => Promise<void>
  assignGpu: (name: string) => Promise<void>
  /** Save the draft config and trigger a driver reload to pick it up. */
  saveAndApply: () => Promise<void>
}

let initialized = false

export const useDriver = create<DriverState>((set, get) => ({
  status: null,
  iddcx: null,
  sysInfo: null,
  gpus: [],
  gpusLoading: false,
  busy: null,

  init: async () => {
    if (initialized) return
    initialized = true
    window.vdd.events.onStatus((status) => {
      const previous = get().status
      set({ status })
      if (previous && previous.level !== status.level) {
        const toast = useUi.getState().toast
        if (status.level === 'online') {
          toast('success', 'Driver online', 'The virtual display driver is responding.')
          // The live pipe may report a more precise IddCx version than the
          // offline build-table fallback - refresh now that it answers.
          void window.vdd.driver
            .iddcxVersion()
            .then((iddcx) => set({ iddcx }))
            .catch(() => undefined)
        } else if (previous.level === 'online') {
          toast('warning', 'Driver went offline')
        }
      }
    })
    void get().refreshStatus()
    try {
      const sysInfo = await window.vdd.system.info()
      set({ sysInfo })
    } catch {
      // ignore
    }
    void window.vdd.driver
      .iddcxVersion()
      .then((iddcx) => set({ iddcx }))
      .catch(() => undefined)
  },

  refreshStatus: async (force = false) => {
    try {
      const status = await window.vdd.driver.status(force)
      set({ status })
    } catch {
      // main not ready yet
    }
  },

  refreshGpus: async () => {
    set({ gpusLoading: true })
    try {
      const gpus = await window.vdd.driver.gpus()
      set({ gpus })
    } finally {
      set({ gpusLoading: false })
    }
  },

  applyDisplayCount: async (count) => {
    const { status } = get()
    const settings = useSettings.getState()
    const toast = useUi.getState().toast

    if (!status?.pipeConnected) {
      settings.patch((d) => (d.monitors.count = count))
      toast('info', 'Driver offline', 'Display count staged - it will apply when the config is saved and the driver restarts.')
      return
    }

    set({ busy: count === 0 ? 'Removing all virtual displays…' : `Reconfiguring to ${count} display${count === 1 ? '' : 's'}…` })
    try {
      const result = await window.vdd.pipe.setDisplayCount(count)
      if (result.ok) {
        toast('success', `Display count set to ${count}`, `Driver reloaded in ${(result.durationMs / 1000).toFixed(1)}s`)
      } else {
        toast('error', 'Failed to set display count', result.error)
      }
    } finally {
      set({ busy: null })
      // The driver rewrote vdd_settings.xml - resync our copy and status.
      await useSettings.getState().load()
      await get().refreshStatus()
    }
  },

  quickToggle: async (name, value, label) => {
    const { status } = get()
    const settings = useSettings.getState()
    const toast = useUi.getState().toast

    if (!status?.pipeConnected) {
      settings.patch((d) => TOGGLE_PATCHES[name](d, value))
      toast('info', `${label} staged`, 'Driver offline - save the configuration to persist this change.')
      return
    }

    const reloads = name !== 'LOGGING' && name !== 'LOG_DEBUG'
    if (reloads) set({ busy: `Applying ${label}…` })
    try {
      const result = await window.vdd.pipe.toggle(name, value)
      if (result.ok) {
        toast('success', `${label} ${value ? 'enabled' : 'disabled'}`, reloads ? 'Driver reloaded.' : undefined)
      } else {
        toast('error', `Failed to toggle ${label}`, result.error)
      }
    } finally {
      if (reloads) set({ busy: null })
      await useSettings.getState().load()
    }
  },

  assignGpu: async (name) => {
    const { status } = get()
    const settings = useSettings.getState()
    const toast = useUi.getState().toast

    if (!status?.pipeConnected) {
      settings.patch((d) => (d.gpu.friendlyName = name))
      toast('info', 'GPU staged', 'Driver offline - save the configuration to persist this change.')
      return
    }

    set({ busy: `Assigning ${name}…` })
    try {
      const result = await window.vdd.pipe.setGpu(name)
      if (result.ok) toast('success', 'GPU assigned', `Virtual displays now render on ${name}.`)
      else toast('error', 'Failed to assign GPU', result.error)
    } finally {
      set({ busy: null })
      await useSettings.getState().load()
      await get().refreshGpus()
    }
  },

  saveAndApply: async () => {
    const settings = useSettings.getState()
    const toast = useUi.getState().toast
    const count = settings.draft.monitors.count

    const saved = await settings.save()
    if (!saved) return

    const { status } = get()
    if (!status?.pipeConnected) {
      toast('info', 'Saved', 'Driver offline - the new configuration loads on next driver start.')
      return
    }

    set({ busy: 'Reloading driver with new configuration…' })
    try {
      const result = await window.vdd.pipe.setDisplayCount(count)
      if (result.ok) {
        toast('success', 'Configuration applied', `Driver reloaded in ${(result.durationMs / 1000).toFixed(1)}s`)
      } else {
        toast('error', 'Reload failed', result.error)
      }
    } finally {
      set({ busy: null })
      await useSettings.getState().load()
      await get().refreshStatus()
    }
  }
}))
