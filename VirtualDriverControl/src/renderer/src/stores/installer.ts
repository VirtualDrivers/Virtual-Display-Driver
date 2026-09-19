import { create } from 'zustand'
import type { InstallProgress, LifecycleResult, ManagedDeviceState, ManagedDriverId, ReleaseInfo } from '@shared/types'
import { useDriver } from './driver'
import { useSettings } from './settings'
import { useUi } from './ui'

export type LifecycleOp = 'install' | 'uninstall' | 'restart' | 'instances' | 'testsigning'

interface DriverLifecycleState {
  latest: ReleaseInfo | null
  installedTag: string | null
  device: ManagedDeviceState | null
  checking: boolean
  checkError: string | null
}

interface InstallerState {
  drivers: Record<ManagedDriverId, DriverLifecycleState>
  /** Which driver+operation is in flight (lifecycle ops are globally exclusive). */
  working: { driver: ManagedDriverId; op: LifecycleOp } | null
  progress: InstallProgress | null
  /** Windows boot-config test signing state (audio driver is test-signed). */
  testSigning: boolean | null
  init: () => void
  checkLatest: (driver: ManagedDriverId) => Promise<void>
  refreshDevice: (driver: ManagedDriverId) => Promise<void>
  install: (driver: ManagedDriverId, instances?: number) => Promise<void>
  uninstallDriver: (driver: ManagedDriverId) => Promise<void>
  restartDevice: (driver: ManagedDriverId) => Promise<void>
  setInstances: (driver: ManagedDriverId, count: number) => Promise<void>
  refreshTestSigning: () => Promise<void>
  setTestSigning: (enabled: boolean) => Promise<void>
}

const emptyState = (): DriverLifecycleState => ({
  latest: null,
  installedTag: null,
  device: null,
  checking: false,
  checkError: null
})

let initialized = false

export const useInstaller = create<InstallerState>((set, get) => {
  const patchDriver = (driver: ManagedDriverId, patch: Partial<DriverLifecycleState>): void => {
    set((s) => ({ drivers: { ...s.drivers, [driver]: { ...s.drivers[driver], ...patch } } }))
  }

  const refreshAfter = async (driver: ManagedDriverId): Promise<void> => {
    await get().refreshDevice(driver)
    const installedTag = await window.vdd.installer.installedTag(driver).catch(() => null)
    patchDriver(driver, { installedTag })
    if (driver === 'display') {
      await useDriver.getState().refreshStatus(true)
      await useSettings.getState().load()
    } else {
      // Audio endpoints appear/disappear with the device nodes.
      const { useAudio } = await import('./audio')
      void useAudio.getState().refreshEndpoints()
      void useAudio.getState().refreshWebDevices()
    }
  }

  const runOp = async (
    driver: ManagedDriverId,
    op: LifecycleOp,
    action: () => Promise<LifecycleResult>,
    successTitle: string,
    successMessage: string | undefined,
    failTitle: string
  ): Promise<void> => {
    if (get().working) return
    const toast = useUi.getState().toast
    set({ working: { driver, op }, progress: null })
    try {
      const result = await action()
      if (result.ok) toast('success', successTitle, successMessage)
      else toast('error', failTitle, result.error ?? result.detail)
    } finally {
      set({ working: null, progress: null })
      await refreshAfter(driver)
    }
  }

  return {
    drivers: { display: emptyState(), audio: emptyState() },
    working: null,
    progress: null,
    testSigning: null,

    init: () => {
      if (initialized) return
      initialized = true
      window.vdd.events.onInstallProgress((progress) => set({ progress }))
      for (const driver of ['display', 'audio'] as ManagedDriverId[]) {
        void window.vdd.installer
          .installedTag(driver)
          .then((installedTag) => patchDriver(driver, { installedTag }))
          .catch(() => undefined)
        void get().refreshDevice(driver)
      }
      void get().refreshTestSigning()
    },

    checkLatest: async (driver) => {
      patchDriver(driver, { checking: true, checkError: null })
      try {
        const latest = await window.vdd.installer.latestRelease(driver)
        patchDriver(driver, { latest })
      } catch (error) {
        patchDriver(driver, { checkError: error instanceof Error ? error.message : String(error) })
      } finally {
        patchDriver(driver, { checking: false })
      }
    },

    refreshDevice: async (driver) => {
      try {
        const device = await window.vdd.installer.deviceState(driver)
        patchDriver(driver, { device })
      } catch {
        // main not ready
      }
    },

    install: (driver, instances) =>
      runOp(
        driver,
        'install',
        () => window.vdd.installer.install(driver, instances),
        'Driver installed',
        driver === 'display'
          ? 'The Virtual Display Driver is now installed and starting up.'
          : 'The Virtual Audio Driver is now installed - new audio devices should appear shortly.',
        'Install failed'
      ),

    uninstallDriver: (driver) =>
      runOp(
        driver,
        'uninstall',
        () => window.vdd.installer.uninstall(driver),
        'Driver uninstalled',
        driver === 'display' ? 'Configuration files were kept for a future reinstall.' : undefined,
        'Uninstall failed'
      ),

    restartDevice: (driver) =>
      runOp(
        driver,
        'restart',
        () => window.vdd.installer.restartDevice(driver),
        'Device restarted',
        'The device was disabled and re-enabled.',
        'Restart failed'
      ),

    setInstances: (driver, count) =>
      runOp(
        driver,
        'instances',
        () => window.vdd.installer.setInstances(driver, count),
        'Device count updated',
        `${count} virtual audio device${count === 1 ? '' : 's'} now present.`,
        'Failed to change device count'
      ),

    refreshTestSigning: async () => {
      try {
        set({ testSigning: await window.vdd.installer.testSigning() })
      } catch {
        // main not ready
      }
    },

    setTestSigning: async (enabled) => {
      if (get().working) return
      const toast = useUi.getState().toast
      set({ working: { driver: 'audio', op: 'testsigning' }, progress: null })
      try {
        const result = await window.vdd.installer.setTestSigning(enabled)
        if (result.ok) {
          toast('success', `Test signing ${enabled ? 'enabled' : 'disabled'}`, 'Restart Windows for the change to take effect.')
        } else {
          toast('error', 'Test signing change failed', result.error ?? result.detail)
        }
      } finally {
        set({ working: null, progress: null })
        await get().refreshTestSigning()
      }
    }
  }
})
