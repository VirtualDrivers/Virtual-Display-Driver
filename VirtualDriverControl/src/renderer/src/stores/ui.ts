import { create } from 'zustand'
import type { AppPreferences, BaseDirResult } from '@shared/types'

export type PageId = 'dashboard' | 'displays' | 'color' | 'edid' | 'gpu' | 'audio' | 'console' | 'settings'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
}

interface UiState {
  page: PageId
  prefs: AppPreferences
  prefsLoaded: boolean
  toasts: Toast[]
  maximized: boolean
  setPage: (page: PageId) => void
  toast: (kind: ToastKind, title: string, message?: string) => void
  dismissToast: (id: number) => void
  initPrefs: () => Promise<void>
  updatePrefs: (patch: Partial<AppPreferences>) => Promise<void>
  /** Changes the driver folder (syncs the VDDPATH registry value in main). */
  setBaseDir: (baseDir: string) => Promise<BaseDirResult>
  setMaximized: (value: boolean) => void
}

let toastId = 1

function applyTheme(prefs: AppPreferences): void {
  const root = document.documentElement
  const resolved =
    prefs.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : prefs.theme
  root.dataset.theme = resolved
  root.style.setProperty('--accent', prefs.accent)
}

export const useUi = create<UiState>((set, get) => ({
  page: 'dashboard',
  prefs: { theme: 'dark', accent: '#4cc2ff', baseDir: 'C:\\VirtualDisplayDriver', audioRoutes: [] },
  prefsLoaded: false,
  toasts: [],
  maximized: false,

  setPage: (page) => set({ page }),

  toast: (kind, title, message) => {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, title, message }] }))
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4200)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  initPrefs: async () => {
    try {
      const prefs = await window.vdd.prefs.get()
      applyTheme(prefs)
      set({ prefs, prefsLoaded: true })
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(get().prefs))
    } catch {
      set({ prefsLoaded: true })
    }
  },

  updatePrefs: async (patch) => {
    const prefs = await window.vdd.prefs.set(patch)
    applyTheme(prefs)
    set({ prefs })
  },

  setBaseDir: async (baseDir) => {
    const result = await window.vdd.prefs.setBaseDir(baseDir)
    set({ prefs: result.prefs })
    return result
  },

  setMaximized: (value) => set({ maximized: value })
}))
