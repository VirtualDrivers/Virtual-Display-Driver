import { create } from 'zustand'
import { SYSTEM_AUDIO_SOURCE, type AudioEndpoint, type AudioRoute } from '@shared/types'
import { audioRouter } from '@renderer/utils/audio-router'
import { useUi } from './ui'

export interface WebAudioDevice {
  deviceId: string
  label: string
}

interface AudioState {
  endpoints: AudioEndpoint[]
  endpointsLoading: boolean
  endpointsError: string | null
  webInputs: WebAudioDevice[]
  webOutputs: WebAudioDevice[]
  routes: AudioRoute[]
  /** Route ids currently pumping audio. */
  activeRoutes: Set<string>
  routeErrors: Record<string, string>
  init: () => Promise<void>
  refreshEndpoints: () => Promise<void>
  refreshWebDevices: () => Promise<void>
  setEndpointVolume: (id: string, volume: number) => void
  setEndpointMute: (id: string, muted: boolean) => Promise<void>
  setDefaultEndpoint: (id: string) => Promise<void>
  addRoute: (sourceId: string, sourceLabel: string, sinkId: string, sinkLabel: string) => Promise<void>
  removeRoute: (routeId: string) => Promise<void>
  toggleRoute: (routeId: string, enabled: boolean) => Promise<void>
  setRouteGain: (routeId: string, gain: number) => void
}

let initialized = false
const volumeTimers = new Map<string, number>()

function persistRoutes(routes: AudioRoute[]): void {
  void useUi.getState().updatePrefs({ audioRoutes: routes })
}

async function armRoute(route: AudioRoute, set: (fn: (s: AudioState) => Partial<AudioState>) => void): Promise<void> {
  try {
    await audioRouter.start(route)
    set((s) => {
      const active = new Set(s.activeRoutes)
      active.add(route.id)
      const errors = { ...s.routeErrors }
      delete errors[route.id]
      return { activeRoutes: active, routeErrors: errors }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    set((s) => ({ routeErrors: { ...s.routeErrors, [route.id]: message } }))
  }
}

export const useAudio = create<AudioState>((set, get) => ({
  endpoints: [],
  endpointsLoading: false,
  endpointsError: null,
  webInputs: [],
  webOutputs: [],
  routes: [],
  activeRoutes: new Set<string>(),
  routeErrors: {},

  init: async () => {
    if (initialized) return
    initialized = true

    audioRouter.setOnEnded((routeId) => {
      set((s) => {
        const active = new Set(s.activeRoutes)
        active.delete(routeId)
        return {
          activeRoutes: active,
          routeErrors: { ...s.routeErrors, [routeId]: 'Source device stopped (unplugged or removed)' }
        }
      })
    })

    navigator.mediaDevices.addEventListener('devicechange', () => void get().refreshWebDevices())

    const routes = useUi.getState().prefs.audioRoutes ?? []
    set({ routes })

    void get().refreshEndpoints()
    await get().refreshWebDevices()

    // Re-arm persisted routes.
    for (const route of routes) {
      if (route.enabled) void armRoute(route, set)
    }
  },

  refreshEndpoints: async () => {
    set({ endpointsLoading: true })
    try {
      const endpoints = await window.vdd.audio.endpoints()
      set({ endpoints, endpointsError: null })
    } catch (error) {
      set({ endpointsError: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ endpointsLoading: false })
    }
  },

  refreshWebDevices: async () => {
    try {
      // A one-shot capture unlocks device labels for enumerateDevices.
      if (get().webInputs.every((d) => !d.label)) {
        try {
          const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
          for (const track of probe.getTracks()) track.stop()
        } catch {
          // no mic permission/device - labels may stay generic
        }
      }
      const devices = await navigator.mediaDevices.enumerateDevices()
      const dedupe = (kind: MediaDeviceKind): WebAudioDevice[] =>
        devices
          .filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Unnamed device' }))
      set({ webInputs: dedupe('audioinput'), webOutputs: dedupe('audiooutput') })
    } catch {
      // media enumeration unavailable
    }
  },

  setEndpointVolume: (id, volume) => {
    set((s) => ({ endpoints: s.endpoints.map((e) => (e.id === id ? { ...e, volume } : e)) }))
    const existing = volumeTimers.get(id)
    if (existing !== undefined) window.clearTimeout(existing)
    volumeTimers.set(
      id,
      window.setTimeout(() => {
        volumeTimers.delete(id)
        window.vdd.audio.setVolume(id, volume).catch((error: unknown) => {
          useUi.getState().toast('error', 'Volume change failed', error instanceof Error ? error.message : String(error))
        })
      }, 150)
    )
  },

  setEndpointMute: async (id, muted) => {
    set((s) => ({ endpoints: s.endpoints.map((e) => (e.id === id ? { ...e, muted } : e)) }))
    try {
      await window.vdd.audio.setMute(id, muted)
    } catch (error) {
      useUi.getState().toast('error', 'Mute change failed', error instanceof Error ? error.message : String(error))
      await get().refreshEndpoints()
    }
  },

  setDefaultEndpoint: async (id) => {
    try {
      await window.vdd.audio.setDefault(id)
      await get().refreshEndpoints()
      const endpoint = get().endpoints.find((e) => e.id === id)
      useUi.getState().toast('success', 'Default device changed', endpoint?.name)
    } catch (error) {
      useUi.getState().toast('error', 'Failed to set default device', error instanceof Error ? error.message : String(error))
    }
  },

  addRoute: async (sourceId, sourceLabel, sinkId, sinkLabel) => {
    const route: AudioRoute = {
      id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sourceId,
      sourceLabel,
      sinkId,
      sinkLabel,
      gain: 1,
      enabled: true
    }
    const routes = [...get().routes, route]
    set({ routes })
    persistRoutes(routes)
    await armRoute(route, set)
  },

  removeRoute: async (routeId) => {
    audioRouter.stop(routeId)
    const routes = get().routes.filter((r) => r.id !== routeId)
    set((s) => {
      const active = new Set(s.activeRoutes)
      active.delete(routeId)
      const errors = { ...s.routeErrors }
      delete errors[routeId]
      return { routes, activeRoutes: active, routeErrors: errors }
    })
    persistRoutes(routes)
  },

  toggleRoute: async (routeId, enabled) => {
    const routes = get().routes.map((r) => (r.id === routeId ? { ...r, enabled } : r))
    set({ routes })
    persistRoutes(routes)
    const route = routes.find((r) => r.id === routeId)
    if (!route) return
    if (enabled) {
      await armRoute(route, set)
    } else {
      audioRouter.stop(routeId)
      set((s) => {
        const active = new Set(s.activeRoutes)
        active.delete(routeId)
        return { activeRoutes: active }
      })
    }
  },

  setRouteGain: (routeId, gain) => {
    const routes = get().routes.map((r) => (r.id === routeId ? { ...r, gain } : r))
    set({ routes })
    audioRouter.setGain(routeId, gain)
    persistRoutes(routes)
  }
}))

export { SYSTEM_AUDIO_SOURCE }
