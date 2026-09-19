import { create } from 'zustand'
import { DEFAULT_VDD_SETTINGS } from '@shared/defaults'
import type { VddSettings } from '@shared/types'
import { useUi } from './ui'

interface SettingsState {
  /** Editable draft shown in the UI. */
  draft: VddSettings
  /** Last state loaded from disk. */
  saved: VddSettings
  isDefault: boolean
  loaded: boolean
  dirty: boolean
  loadError: string | null
  load: () => Promise<void>
  patch: (mutate: (draft: VddSettings) => void) => void
  discard: () => void
  /** Persist the draft to vdd_settings.xml. Returns success. */
  save: () => Promise<boolean>
}

function clone(settings: VddSettings): VddSettings {
  return structuredClone(settings)
}

function equal(a: VddSettings, b: VddSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export const useSettings = create<SettingsState>((set, get) => ({
  draft: clone(DEFAULT_VDD_SETTINGS),
  saved: clone(DEFAULT_VDD_SETTINGS),
  isDefault: true,
  loaded: false,
  dirty: false,
  loadError: null,

  load: async () => {
    try {
      const result = await window.vdd.settings.load()
      if (result.ok && result.settings) {
        set({
          draft: clone(result.settings),
          saved: clone(result.settings),
          isDefault: result.isDefault,
          loaded: true,
          dirty: false,
          loadError: null
        })
      } else {
        set({ loaded: true, loadError: result.error ?? 'Failed to load settings' })
      }
    } catch (error) {
      set({ loaded: true, loadError: error instanceof Error ? error.message : String(error) })
    }
  },

  patch: (mutate) => {
    const next = clone(get().draft)
    mutate(next)
    set({ draft: next, dirty: !equal(next, get().saved) })
  },

  discard: () => set({ draft: clone(get().saved), dirty: false }),

  save: async () => {
    const { draft } = get()
    try {
      const result = await window.vdd.settings.save(draft)
      if (result.ok) {
        set({ saved: clone(draft), dirty: false, isDefault: false })
        useUi
          .getState()
          .toast('success', 'Configuration saved', result.backupCreated ? `Backup: ${result.backupCreated}` : undefined)
        return true
      }
      useUi.getState().toast('error', 'Save failed', result.error)
      return false
    } catch (error) {
      useUi.getState().toast('error', 'Save failed', error instanceof Error ? error.message : String(error))
      return false
    }
  }
}))
