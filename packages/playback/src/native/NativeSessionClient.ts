import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export type NativeAudioDriver = 'null' | 'cpal'
export type NativeSessionState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'audio-running'
  | 'shutting-down'
  | 'failed'

export interface NativeSessionCapabilities {
  readonly protocolVersion: number
  readonly drivers: readonly NativeAudioDriver[]
  readonly messages: readonly string[]
}

export interface NativeAudioDeviceInfo {
  readonly id: string
  readonly name: string
  readonly isDefault: boolean
}

export interface NativeAudioStartRequest {
  readonly driver: NativeAudioDriver
  readonly device?: string
  readonly sampleRate?: number
  readonly bufferFrames?: number
  readonly channels?: number
}

export interface NativeActiveStreamInfo {
  readonly driver: NativeAudioDriver
  readonly deviceId: string
  readonly deviceName: string
  readonly sampleRate: number
  readonly channels: number
  readonly sampleFormat: string
  readonly requestedBufferFrames?: number
}

export interface NativeEngineSnapshot {
  readonly stream: {
    readonly deviceId: string
    readonly sampleRate: number
    readonly channels: number
  } | null
  readonly telemetry: {
    readonly samplePosition: number
    readonly callbackCount: number
    readonly sampleRate: number
    readonly callbackFrames: number
    readonly outputChannels: number
  } | null
}

export interface NativeSessionClientOptions {
  readonly command?: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly shutdownTimeoutMs?: number
}

type PendingRequest = {
  readonly type: string
  readonly resolve: (value: NativeSessionMessage) => void
  readonly reject: (error: Error) => void
}

type NativeSessionMessage = Record<string, unknown>

export class NativeSessionClient {
  private readonly command: string
  private readonly args: readonly string[]
  private readonly cwd: string | undefined
  private readonly shutdownTimeoutMs: number
  private child?: ChildProcessWithoutNullStreams
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private nextRequestId = 1
  private readyResolver?: (value: void) => void
  private readyRejecter?: (error: Error) => void
  private readonly pending = new Map<number, PendingRequest>()
  private currentState: NativeSessionState = 'stopped'

  constructor(options: NativeSessionClientOptions = {}) {
    this.command = options.command ?? 'cargo'
    this.args = options.args ?? ['run', '-p', 'engine-host', '--', '--session-stdio']
    this.cwd = options.cwd
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 1_000
  }

  get state(): NativeSessionState {
    return this.currentState
  }

  get stderr(): string {
    return this.stderrBuffer
  }

  async start(): Promise<NativeSessionCapabilities> {
    if (this.currentState !== 'stopped') {
      throw new Error(`native session cannot start from ${this.currentState}`)
    }

    this.currentState = 'starting'
    const child = spawn(this.command, [...this.args], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
    child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk
    })
    child.once('error', (error) => this.fail(error))
    child.once('exit', (code, signal) => {
      if (this.currentState !== 'stopped') {
        this.fail(
          new Error(
            `native session exited unexpectedly with code ${code ?? 'null'} signal ${
              signal ?? 'null'
            }`
          )
        )
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve
      this.readyRejecter = reject
    })

    const hello = await this.request<{ readonly protocolVersion?: number }>(
      'session:hello'
    )
    const capabilities = await this.request<Omit<NativeSessionCapabilities, 'protocolVersion'>>(
      'session:capabilities'
    )

    this.currentState = 'ready'
    return {
      ...capabilities,
      protocolVersion:
        typeof hello.protocolVersion === 'number' ? hello.protocolVersion : 0
    }
  }

  async listAudioDevices(
    driver: NativeAudioDriver
  ): Promise<NativeAudioDeviceInfo[]> {
    this.ensureReady()
    const response = await this.request<{ readonly devices?: unknown }>(
      'audio:list-devices',
      { driver }
    )

    return Array.isArray(response.devices)
      ? (response.devices as NativeAudioDeviceInfo[])
      : []
  }

  async startAudio(
    request: NativeAudioStartRequest
  ): Promise<NativeActiveStreamInfo> {
    this.ensureReady()
    if (this.currentState === 'audio-running') {
      throw new Error('native audio is already running')
    }

    const response = await this.request<NativeActiveStreamInfo>('audio:start', {
      driver: request.driver,
      device: request.device,
      sample_rate: request.sampleRate,
      buffer_frames: request.bufferFrames,
      channels: request.channels
    })

    this.currentState = 'audio-running'
    return response
  }

  async stopAudio(): Promise<void> {
    if (this.currentState === 'stopped') return
    if (this.currentState !== 'audio-running') return

    await this.request('audio:stop')
    this.currentState = 'ready'
  }

  async getSnapshot(): Promise<NativeEngineSnapshot> {
    this.ensureReady()
    return this.request<NativeEngineSnapshot>('engine:snapshot')
  }

  async shutdown(): Promise<void> {
    if (this.currentState === 'stopped') return

    const child = this.child

    this.currentState = 'shutting-down'

    try {
      if (child && !child.killed) {
        await this.request('session:shutdown')
      }
    } finally {
      await this.finishShutdown(child)
    }
  }

  private async request<T extends object = NativeSessionMessage>(
    type: string,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    const child = this.child

    if (!child || !child.stdin.writable) {
      throw new Error('native session is not running')
    }

    const requestId = this.nextRequestId++
    const message = JSON.stringify(compactObject({ requestId, type, ...payload }))

    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        type,
        resolve: (value) => resolve(value as T),
        reject
      })
      child.stdin.write(`${message}\n`, (error) => {
        if (error) {
          this.pending.delete(requestId)
          reject(error)
        }
      })
    })
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n')

      if (newlineIndex < 0) return

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim()

      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)

      if (line.length > 0) {
        this.handleLine(line)
      }
    }
  }

  private handleLine(line: string): void {
    const message = parseNativeSessionLine(line)
    const requestId = numberValue(message.requestId)

    if (requestId === undefined) {
      if (message.type === 'session:ready') {
        this.readyResolver?.()
        this.readyResolver = undefined
        this.readyRejecter = undefined
      }
      return
    }

    const pending = this.pending.get(requestId)

    if (!pending) {
      this.fail(new Error(`native session returned unknown requestId ${requestId}`))
      return
    }

    this.pending.delete(requestId)

    if (message.ok === false) {
      pending.reject(
        new Error(
          `${String(message.code ?? 'NativeSessionError')}: ${String(
            message.message ?? 'native request failed'
          )}`
        )
      )
      return
    }

    pending.resolve(message)
  }

  private ensureReady(): void {
    if (this.currentState !== 'ready' && this.currentState !== 'audio-running') {
      throw new Error(`native session is not ready: ${this.currentState}`)
    }
  }

  private fail(error: Error): void {
    if (this.currentState === 'stopped') return

    this.currentState = 'failed'
    this.readyRejecter?.(error)
    this.readyResolver = undefined
    this.readyRejecter = undefined

    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }

  private async finishShutdown(
    child: ChildProcessWithoutNullStreams | undefined
  ): Promise<void> {
    if (!child) {
      this.currentState = 'stopped'
      return
    }

    child.stdin.end()

    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
          resolve()
        }, this.shutdownTimeoutMs)
      )
    ])

    this.child = undefined
    this.pending.clear()
    this.currentState = 'stopped'
  }
}

export function parseNativeSessionLine(line: string): NativeSessionMessage {
  try {
    const value = JSON.parse(line) as unknown

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('native session line is not a JSON object')
    }

    return value as NativeSessionMessage
  } catch (error) {
    throw new Error(
      `failed to parse native session JSONL: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

function compactObject(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  )
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}
