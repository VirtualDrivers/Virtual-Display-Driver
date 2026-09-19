import { execFile } from 'child_process'
import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { createConnection, Socket } from 'net'
import { join } from 'path'
import { promisify } from 'util'
import { app } from 'electron'
import type { DriverLiveSettings, PipeResult, PipeToggleCommand } from '@shared/types'

const execFileAsync = promisify(execFile)

const PIPE_PATH = '\\\\.\\pipe\\MTTVirtualDisplayPipe'

/**
 * Commands the driver answers with data. These need the PowerShell round trip:
 * the driver responds with WriteFile immediately followed by
 * DisconnectNamedPipe, which discards anything the client has not read yet.
 * Only a client with an overlapped read already pending in the kernel receives
 * the data - Node's net stack reads too late by design, .NET ReadAsync works.
 */
const RESPONSE_COMMANDS = new Set(['GETSETTINGS', 'GETALLGPUS', 'GETASSIGNEDGPU', 'IDDCXVERSION'])

/** Round-trip helper: arms an overlapped read before writing the command. */
const HELPER_PS1 = `param([Parameter(Mandatory=$true)][string]$CommandB64, [int]$TimeoutMs = 10000)
$ErrorActionPreference = 'Stop'
try { if (-not (Test-Path '\\\\.\\pipe\\MTTVirtualDisplayPipe')) { exit 2 } } catch { }
$cmd = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($CommandB64))
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'MTTVirtualDisplayPipe', [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::Asynchronous)
try {
  try { $pipe.Connect(4000) } catch { exit 3 }
  $buf = New-Object byte[] 65536
  $mem = New-Object System.IO.MemoryStream
  $read = $pipe.ReadAsync($buf, 0, $buf.Length)
  Start-Sleep -Milliseconds 30
  $bytes = [System.Text.Encoding]::Unicode.GetBytes($cmd)
  $pipe.Write($bytes, 0, $bytes.Length)
  $pipe.Flush()
  if (-not $read.Wait($TimeoutMs)) { exit 4 }
  $n = 0
  try { $n = $read.Result } catch { $n = 0 }
  while ($n -gt 0) {
    $mem.Write($buf, 0, $n)
    $read = $pipe.ReadAsync($buf, 0, $buf.Length)
    if (-not $read.Wait(400)) { break }
    try { $n = $read.Result } catch { $n = 0 }
  }
  [Console]::Out.Write([Convert]::ToBase64String($mem.ToArray()))
  exit 0
} catch {
  exit 5
} finally {
  $pipe.Dispose()
}
`

/** Commands that trigger an internal driver reload (heavyweight, 2-8s). */
const RELOAD_COMMANDS = new Set([
  'SETDISPLAYCOUNT',
  'SETGPU',
  'HDRPLUS',
  'SDR10',
  'CUSTOMEDID',
  'PREVENTSPOOF',
  'CEAOVERRIDE',
  'HARDWARECURSOR'
])

const DEFAULT_TIMEOUT_MS = 10_000
const RELOAD_TIMEOUT_MS = 45_000
const CONNECT_TIMEOUT_MS = 4_000
/** Minimum spacing between reload-triggering commands (driver stability). */
const RELOAD_COOLDOWN_MS = 3_000

export interface PipeSendOptions {
  timeoutMs?: number
  /** Suppress activity events (used by the heartbeat PING). */
  quiet?: boolean
}

/**
 * Client for \\.\pipe\MTTVirtualDisplayPipe.
 *
 * Protocol rules implemented here:
 * - one-shot connection per command (driver disconnects after responding)
 * - commands written as UTF-16LE, responses read until disconnect
 * - responses decoded as UTF-8 except GETSETTINGS (UTF-16LE)
 * - all commands fully serialized; reload-triggering commands get a cooldown
 * - RELOAD_DRIVER is never sent (upstream undefined behavior, issue #351)
 * - fire-and-forget commands go through a Node socket; the server closing the
 *   pipe right after reading the command (EPIPE) counts as success
 * - response-bearing commands go through a PowerShell helper that arms an
 *   overlapped read before writing, otherwise the driver's write-then-
 *   disconnect pattern discards the response before it can be read
 */
export class PipeClient extends EventEmitter {
  private queue: Promise<unknown> = Promise.resolve()
  private lastReloadFinishedAt = 0
  private helperPath: string | null = null

  /** Serialized send. Resolves with a PipeResult, never rejects. */
  send(command: string, options: PipeSendOptions = {}): Promise<PipeResult> {
    const run = this.queue.then(() => this.execute(command, options))
    this.queue = run.catch(() => undefined)
    return run
  }

  async ping(): Promise<boolean> {
    // Connect + write succeeding proves the driver's pipe server handled the
    // command; the PONG reply itself is unreadable without the PS helper and
    // not worth a powershell spawn every heartbeat.
    const result = await this.send('PING', { timeoutMs: 3_000, quiet: true })
    return result.ok
  }

  async setDisplayCount(count: number): Promise<PipeResult> {
    const n = Math.max(0, Math.min(99, Math.floor(count)))
    return this.send(`SETDISPLAYCOUNT ${n}`)
  }

  async setToggle(name: PipeToggleCommand, value: boolean): Promise<PipeResult> {
    return this.send(`${name} ${value ? 'true' : 'false'}`)
  }

  async setGpu(friendlyName: string): Promise<PipeResult> {
    const clean = friendlyName.replace(/["\r\n]/g, '').slice(0, 100)
    return this.send(`SETGPU "${clean}"`)
  }

  async getDriverSettings(): Promise<DriverLiveSettings | null> {
    const result = await this.send('GETSETTINGS')
    if (!result.ok) return null
    const match = result.response.match(/SETTINGS\s+DEBUG=(true|false)\s+LOG=(true|false)/i)
    if (!match) return null
    return { debug: match[1].toLowerCase() === 'true', log: match[2].toLowerCase() === 'true' }
  }

  private isReloadCommand(command: string): boolean {
    const head = command.split(' ')[0].toUpperCase()
    return RELOAD_COMMANDS.has(head)
  }

  private async execute(command: string, options: PipeSendOptions): Promise<PipeResult> {
    const started = Date.now()
    const reload = this.isReloadCommand(command)
    const timeoutMs = options.timeoutMs ?? (reload ? RELOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)

    if (command.toUpperCase() === 'RELOAD_DRIVER') {
      return this.finish(command, started, options, {
        ok: false,
        response: '',
        error: 'RELOAD_DRIVER is blocked: it causes undefined behavior in the driver. Use SETDISPLAYCOUNT instead.'
      })
    }
    if (command.length > 127) {
      return this.finish(command, started, options, {
        ok: false,
        response: '',
        error: 'Command exceeds the 127 character pipe buffer limit.'
      })
    }

    if (reload) {
      const wait = this.lastReloadFinishedAt + RELOAD_COOLDOWN_MS - Date.now()
      if (wait > 0) await delay(wait)
    }

    try {
      const head = command.split(' ')[0].toUpperCase()
      const raw = RESPONSE_COMMANDS.has(head)
        ? await this.roundTripPs(command, timeoutMs)
        : await this.roundTrip(command, timeoutMs)
      const isUtf16Response = command.toUpperCase() === 'GETSETTINGS'
      const decoded = raw
        .toString(isUtf16Response ? 'utf16le' : 'utf8')
        .replace(/\0+/g, '')
        .trim()
      return this.finish(command, started, options, { ok: true, response: decoded })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.finish(command, started, options, { ok: false, response: '', error: message })
    } finally {
      if (reload) this.lastReloadFinishedAt = Date.now()
    }
  }

  private finish(
    command: string,
    started: number,
    options: PipeSendOptions,
    partial: { ok: boolean; response: string; error?: string }
  ): PipeResult {
    const result: PipeResult = {
      command,
      ok: partial.ok,
      response: partial.response,
      lines: partial.response.length > 0 ? partial.response.split(/\r?\n/).filter((l) => l.trim().length > 0) : [],
      durationMs: Date.now() - started,
      error: partial.error
    }
    if (!options.quiet) this.emit('result', result)
    return result
  }

  private roundTrip(command: string, timeoutMs: number): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let settled = false
      let wrote = false
      let socket: Socket | null = null

      const overallTimer = setTimeout(() => {
        fail(new Error(`Pipe command timed out after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)

      const succeed = (): void => {
        if (settled) return
        settled = true
        clearTimeout(overallTimer)
        socket?.destroy()
        resolve(Buffer.concat(chunks))
      }

      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(overallTimer)
        socket?.destroy()
        const friendly =
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? new Error('Driver pipe not available (driver not running)')
            : error
        reject(friendly)
      }

      socket = createConnection(PIPE_PATH)
      socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
        // Only treat as failure while still connecting; once data flows we rely on the overall timer.
        if (chunks.length === 0 && socket && socket.connecting) {
          fail(new Error('Timed out connecting to driver pipe'))
        }
      })

      socket.on('connect', () => {
        socket?.setTimeout(0)
        socket?.write(Buffer.from(command, 'utf16le'), (err) => {
          if (err) fail(err)
          else wrote = true
        })
      })
      socket.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      socket.on('end', succeed)
      socket.on('close', succeed)
      socket.on('error', (error) => {
        // The driver disconnects as soon as it has read the command, which
        // surfaces as EPIPE here. The command was delivered - that's success.
        if (wrote && (error as NodeJS.ErrnoException).code === 'EPIPE') succeed()
        else fail(error)
      })
    })
  }

  /**
   * Response-bearing round trip via PowerShell/.NET: an overlapped ReadAsync
   * is pending in the kernel before the command is written, so the response
   * survives the driver's immediate DisconnectNamedPipe. Returns raw bytes
   * (stdout carries them base64-encoded to avoid console encoding mangling).
   */
  private async roundTripPs(command: string, timeoutMs: number): Promise<Buffer> {
    const helper = await this.ensureHelper()
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          helper,
          '-CommandB64',
          Buffer.from(command, 'utf8').toString('base64'),
          '-TimeoutMs',
          String(timeoutMs)
        ],
        { windowsHide: true, timeout: timeoutMs + 15_000, maxBuffer: 4 * 1024 * 1024 }
      )
      return Buffer.from(stdout.trim(), 'base64')
    } catch (error) {
      const code = (error as { code?: number }).code
      if (code === 2) throw new Error('Driver pipe not available (driver not running)')
      if (code === 3) throw new Error('Timed out connecting to driver pipe')
      if (code === 4) throw new Error(`Pipe command timed out after ${Math.round(timeoutMs / 1000)}s`)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private async ensureHelper(): Promise<string> {
    if (this.helperPath) return this.helperPath
    const path = join(app.getPath('userData'), 'pipe-helper.ps1')
    await fs.writeFile(path, HELPER_PS1, 'utf8')
    this.helperPath = path
    return path
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
