import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import { join } from 'path'
import type { LogEvent, LogSeverity, PipeResult } from '@shared/types'
import type { PipeClient } from './pipe-client'

const POLL_INTERVAL_MS = 1_500
const RING_BUFFER_SIZE = 3_000
const INITIAL_TAIL_BYTES = 64 * 1024

/**
 * Streams driver activity into a single unified feed:
 * - tails the daily file log at <baseDir>\Logs\log_YYYY-MM-DD.txt
 * - captures every pipe command's streamed response lines
 */
export class LogService extends EventEmitter {
  private buffer: LogEvent[] = []
  private nextId = 1
  private timer: NodeJS.Timeout | null = null
  private currentFile: string | null = null
  private offset = 0
  private pendingPartial = ''

  constructor(
    private readonly pipe: PipeClient,
    private readonly getBaseDir: () => string
  ) {
    super()
    this.pipe.on('result', (result: PipeResult) => this.capturePipeResult(result))
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.pollFile(), POLL_INTERVAL_MS)
    void this.pollFile()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  recent(): LogEvent[] {
    return this.buffer
  }

  appInfo(message: string): void {
    this.push([this.makeEvent('app', 'info', message)])
  }

  get logsDir(): string {
    return join(this.getBaseDir(), 'Logs')
  }

  private todaysFile(): string {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return join(this.logsDir, `log_${y}-${m}-${d}.txt`)
  }

  private async pollFile(): Promise<void> {
    try {
      const file = this.todaysFile()
      if (!existsSync(file)) {
        if (this.currentFile === file) return
        this.currentFile = null
        return
      }

      const stat = await fs.stat(file)
      if (file !== this.currentFile) {
        // New day or first poll: tail the end of the file rather than re-emitting history.
        this.currentFile = file
        this.offset = Math.max(0, stat.size - INITIAL_TAIL_BYTES)
        this.pendingPartial = ''
      }
      if (stat.size < this.offset) {
        // File truncated/rotated.
        this.offset = 0
        this.pendingPartial = ''
      }
      if (stat.size === this.offset) return

      const handle = await fs.open(file, 'r')
      try {
        const length = stat.size - this.offset
        const chunk = Buffer.alloc(Math.min(length, 1024 * 1024))
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, this.offset)
        this.offset += bytesRead
        const text = this.pendingPartial + chunk.subarray(0, bytesRead).toString('utf8')
        const lines = text.split(/\r?\n/)
        this.pendingPartial = lines.pop() ?? ''
        const events = lines
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .map((line) => this.makeEvent('file', classify(line), line))
        if (events.length > 0) this.push(events)
      } finally {
        await handle.close()
      }
    } catch {
      // Logs folder unreadable - silent, retry next poll.
    }
  }

  private capturePipeResult(result: PipeResult): void {
    const events: LogEvent[] = []
    const head = result.command.split(' ')[0]
    if (!result.ok) {
      events.push(this.makeEvent('pipe', 'error', `${head} failed: ${result.error ?? 'unknown error'}`))
    } else {
      events.push(this.makeEvent('pipe', 'info', `> ${result.command} (${result.durationMs}ms)`))
      for (const line of result.lines.slice(0, 200)) {
        events.push(this.makeEvent('pipe', classify(line), line))
      }
    }
    this.push(events)
  }

  private makeEvent(source: LogEvent['source'], severity: LogSeverity, message: string): LogEvent {
    return { id: this.nextId++, timestamp: Date.now(), source, severity, message: message.slice(0, 2000) }
  }

  private push(events: LogEvent[]): void {
    this.buffer.push(...events)
    if (this.buffer.length > RING_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(this.buffer.length - RING_BUFFER_SIZE)
    }
    this.emit('events', events)
  }
}

function classify(line: string): LogSeverity {
  const lower = line.toLowerCase()
  if (/\b(error|failed|failure|exception|crash)\b/.test(lower)) return 'error'
  if (/\b(warn|warning)\b/.test(lower)) return 'warning'
  if (/\b(debug|trace|verbose)\b/.test(lower)) return 'debug'
  return 'info'
}
