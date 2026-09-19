import { SYSTEM_AUDIO_SOURCE, type AudioRoute } from '@shared/types'

interface ActiveRoute {
  context: AudioContext
  stream: MediaStream
  gainNode: GainNode
  analyser: AnalyserNode
  element: HTMLAudioElement
  levelBuffer: Uint8Array<ArrayBuffer>
}

/**
 * In-app audio pump: captures a source (any microphone/virtual capture device,
 * or the system output via WASAPI loopback) and plays it to any output device
 * through WebAudio. Routes live for as long as the app runs.
 */
class AudioRouter {
  private active = new Map<string, ActiveRoute>()
  private onEnded: ((routeId: string) => void) | null = null

  setOnEnded(handler: (routeId: string) => void): void {
    this.onEnded = handler
  }

  isActive(routeId: string): boolean {
    return this.active.has(routeId)
  }

  async start(route: AudioRoute): Promise<void> {
    this.stop(route.id)

    let stream: MediaStream
    if (route.sourceId === SYSTEM_AUDIO_SOURCE) {
      // Main process answers this with a screen source + 'loopback' audio.
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      for (const track of stream.getVideoTracks()) track.stop()
      if (stream.getAudioTracks().length === 0) {
        for (const track of stream.getTracks()) track.stop()
        throw new Error('System audio loopback is unavailable on this system')
      }
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: route.sourceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
    }

    const context = new AudioContext({ latencyHint: 'interactive' })
    const source = context.createMediaStreamSource(stream)
    const gainNode = context.createGain()
    gainNode.gain.value = route.gain
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    const destination = context.createMediaStreamDestination()
    source.connect(gainNode)
    gainNode.connect(analyser)
    analyser.connect(destination)

    const element = new Audio()
    element.srcObject = destination.stream
    element.autoplay = true
    try {
      await element.setSinkId(route.sinkId)
      await element.play()
    } catch (error) {
      for (const track of stream.getTracks()) track.stop()
      void context.close()
      throw error instanceof Error ? error : new Error(String(error))
    }

    const audioTrack = stream.getAudioTracks()[0]
    audioTrack.addEventListener('ended', () => {
      if (this.active.has(route.id)) {
        this.stop(route.id)
        this.onEnded?.(route.id)
      }
    })

    this.active.set(route.id, {
      context,
      stream,
      gainNode,
      analyser,
      element,
      levelBuffer: new Uint8Array(analyser.frequencyBinCount)
    })
  }

  stop(routeId: string): void {
    const entry = this.active.get(routeId)
    if (!entry) return
    this.active.delete(routeId)
    for (const track of entry.stream.getTracks()) track.stop()
    entry.element.pause()
    entry.element.srcObject = null
    void entry.context.close().catch(() => undefined)
  }

  stopAll(): void {
    for (const id of [...this.active.keys()]) this.stop(id)
  }

  setGain(routeId: string, gain: number): void {
    const entry = this.active.get(routeId)
    if (entry) entry.gainNode.gain.value = gain
  }

  /** Current RMS level 0..1 for the route's signal (for meters). */
  level(routeId: string): number {
    const entry = this.active.get(routeId)
    if (!entry) return 0
    entry.analyser.getByteTimeDomainData(entry.levelBuffer)
    let sum = 0
    for (const sample of entry.levelBuffer) {
      const centered = (sample - 128) / 128
      sum += centered * centered
    }
    return Math.min(1, Math.sqrt(sum / entry.levelBuffer.length) * 2.5)
  }
}

export const audioRouter = new AudioRouter()
