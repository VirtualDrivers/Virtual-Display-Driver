import { create } from 'zustand'
import type { LogEvent, LogSeverity, LogSource } from '@shared/types'

const MAX_EVENTS = 3000

interface LogsState {
  events: LogEvent[]
  severityFilter: Set<LogSeverity>
  sourceFilter: Set<LogSource>
  search: string
  autoScroll: boolean
  init: () => Promise<void>
  clear: () => void
  setSearch: (value: string) => void
  toggleSeverity: (severity: LogSeverity) => void
  toggleSource: (source: LogSource) => void
  setAutoScroll: (value: boolean) => void
}

let initialized = false

export const useLogs = create<LogsState>((set) => ({
  events: [],
  severityFilter: new Set<LogSeverity>(['debug', 'info', 'warning', 'error']),
  sourceFilter: new Set<LogSource>(['file', 'pipe', 'app']),
  search: '',
  autoScroll: true,

  init: async () => {
    if (initialized) return
    initialized = true
    try {
      const recent = await window.vdd.logs.recent()
      set({ events: recent.slice(-MAX_EVENTS) })
    } catch {
      // main not ready - events will arrive via push
    }
    window.vdd.events.onLogs((incoming) => {
      set((s) => {
        const merged = [...s.events, ...incoming]
        return { events: merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged }
      })
    })
  },

  clear: () => set({ events: [] }),
  setSearch: (value) => set({ search: value }),

  toggleSeverity: (severity) =>
    set((s) => {
      const next = new Set(s.severityFilter)
      if (next.has(severity)) next.delete(severity)
      else next.add(severity)
      return { severityFilter: next }
    }),

  toggleSource: (source) =>
    set((s) => {
      const next = new Set(s.sourceFilter)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return { sourceFilter: next }
    }),

  setAutoScroll: (value) => set({ autoScroll: value })
}))
