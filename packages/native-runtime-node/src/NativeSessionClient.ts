import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  EngineCommand,
  NativeActiveStreamInfo,
  NativeAudioDeviceInfo,
  NativeAudioDriver,
  NativeAudioStartRequest,
  NativeEngineCommandResponse,
  NativeEngineSnapshot,
  NativePlanActivation,
  NativePreparedPlanHandle,
  NativeRuntimeCapabilities,
  NativeRuntimeStartOptions,
  NativeSessionCapabilities
} from '@sequencer/playback'

export type NativeSessionState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'audio-running'
  | 'shutting-down'
  | 'failed'

export const NATIVE_SESSION_PROTOCOL_VERSION = 1

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
    const launch = resolveEngineHostLaunch(options)

    this.command = launch.command
    this.args = launch.args
    this.cwd = launch.cwd
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 1_000
  }

  get state(): NativeSessionState {
    return this.currentState
  }

  get stderr(): string {
    return this.stderrBuffer
  }

  async start(_options?: NativeRuntimeStartOptions): Promise<NativeSessionCapabilities> {
    if (this.currentState !== 'stopped') {
      throw new Error(`native session cannot start from ${this.currentState}`)
    }

    this.currentState = 'starting'
    const child = spawn(this.command, [...this.args], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    })

    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
    child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk
    })
    child.once('error', (error) => {
      this.fail(
        new Error(
          `${error.message}\n${this.describeLaunchAttempt()}`
        )
      )
    })
    child.once('exit', (code, signal) => {
      if (this.currentState !== 'stopped') {
        this.fail(
          new Error(
            `native session exited unexpectedly with code ${code ?? 'null'} signal ${
              signal ?? 'null'
            }\n${this.describeLaunchAttempt()}\nstderr: ${this.stderrBuffer.slice(-2_000)}`
          )
        )
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve
      this.readyRejecter = reject
    })

    const hello = await this.request<{
      readonly protocolVersion?: number
      readonly capabilities?: unknown
    }>('session:hello')
    const protocolVersion =
      typeof hello.protocolVersion === 'number' ? hello.protocolVersion : 0

    if (protocolVersion !== NATIVE_SESSION_PROTOCOL_VERSION) {
      throw new Error(
        `unsupported native session protocol ${protocolVersion}; expected ${NATIVE_SESSION_PROTOCOL_VERSION}`
      )
    }

    const capabilities = await this.request<{
      readonly drivers?: readonly NativeAudioDriver[]
      readonly messages?: readonly string[]
      readonly capabilities?: unknown
    }>('session:capabilities')

    this.currentState = 'ready'
    return {
      protocolVersion,
      capabilities: parseRuntimeCapabilities(
        capabilities.capabilities ?? hello.capabilities
      ),
      drivers: capabilities.drivers ?? [],
      messages: capabilities.messages ?? []
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

  async preparePlan(plan: unknown): Promise<NativePreparedPlanHandle> {
    this.ensureReady()
    const response = await this.request<{ readonly handle?: unknown }>(
      'plan:prepare',
      { plan }
    )
    const handle = parsePreparedPlanHandle(response.handle)

    if (!handle) {
      throw new Error('native plan:prepare response did not include a handle')
    }

    return handle
  }

  async activatePlan(
    transferId: number,
    requestedSample = 0
  ): Promise<NativePlanActivation> {
    this.ensureReady()
    const response = await this.request<NativePlanActivation>('plan:activate', {
      transferId,
      requestedSample
    })

    return response
  }

  async sendEngineCommand(
    command: EngineCommand
  ): Promise<NativeEngineCommandResponse> {
    this.ensureReady()

    return this.request<NativeEngineCommandResponse>('engine:command', {
      command: nativeEngineCommandPayload(command)
    })
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
    const enriched = new Error(`${error.message}\n${this.describeLaunchAttempt()}`)
    this.readyRejecter?.(enriched)
    this.readyResolver = undefined
    this.readyRejecter = undefined

    for (const pending of this.pending.values()) {
      pending.reject(enriched)
    }
    this.pending.clear()
  }

  private describeLaunchAttempt(): string {
    return [
      `engine-host command: ${this.command}`,
      `engine-host args: ${JSON.stringify(this.args)}`,
      `engine-host cwd: ${this.cwd ?? '<none>'}`,
      `engine-host env path: ${process.env.SEQUENCER_ENGINE_HOST_PATH ?? '<default>'}`,
      `engine-host env cargo: ${process.env.CARGO ?? '<unset>'}`
    ].join('\n')
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

function resolveEngineHostLaunch(
  options: NativeSessionClientOptions
): { readonly command: string; readonly args: readonly string[]; readonly cwd?: string } {
  const explicitPath = options.command?.trim()
  if (explicitPath) {
    return {
      command: explicitPath,
      args: options.args ?? [],
      cwd: options.cwd
    }
  }

  const configuredPath = process.env.SEQUENCER_ENGINE_HOST_PATH?.trim()
  if (configuredPath && isExecutable(configuredPath)) {
    return {
      command: configuredPath,
      args: options.args ?? ['--session-stdio'],
      cwd: options.cwd ?? defaultEngineHostCwd()
    }
  }

  const defaultPath = defaultEngineHostPath()
  if (isExecutable(defaultPath)) {
    return {
      command: defaultPath,
      args: options.args ?? ['--session-stdio'],
      cwd: options.cwd ?? defaultEngineHostCwd()
    }
  }

  return {
    command: options.command ?? 'cargo',
    args: options.args ?? ['run', '-p', 'engine-host', '--', '--session-stdio'],
    cwd: options.cwd
  }
}

function defaultEngineHostPath(): string {
  return fileURLToPath(new URL('../../../native-audio-engine/target/debug/engine-host', import.meta.url))
}

function defaultEngineHostCwd(): string {
  return fileURLToPath(new URL('../../../native-audio-engine', import.meta.url))
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
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

function parsePreparedPlanHandle(
  value: unknown
): NativePreparedPlanHandle | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const candidate = value as Partial<NativePreparedPlanHandle>

  if (
    typeof candidate.transferId !== 'number' ||
    typeof candidate.planId !== 'number' ||
    typeof candidate.revision !== 'number'
  ) {
    return undefined
  }

  return {
    transferId: candidate.transferId,
    planId: candidate.planId,
    revision: candidate.revision
  }
}

function parseRuntimeCapabilities(value: unknown): NativeRuntimeCapabilities {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<NativeRuntimeCapabilities>)
      : {}

  return {
    executionPlanVersion: Number(candidate.executionPlanVersion ?? 0),
    eventGraphVersion: Number(candidate.eventGraphVersion ?? 0),
    parameterGraphVersion: Number(candidate.parameterGraphVersion ?? 0),
    assets: Boolean(candidate.assets),
    telemetry: Boolean(candidate.telemetry)
  }
}

function nativeEngineCommandPayload(command: EngineCommand): Record<string, unknown> {
  switch (command.type) {
    case 'transport:start':
    case 'transport:stop':
      return {
        type: command.type,
        atSample: command.atSample
      }
    case 'panic':
      return {
        type: command.type,
        atSample: 'atSample' in command ? command.atSample : 0
      }
    case 'tempo-map:set':
      return {
        type: command.type,
        originSample: command.originSample,
        originBeat: command.originBeat,
        bpm: command.bpm,
        sampleRate: command.sampleRate,
        atSample: command.atSample
      }
    case 'transport-loop:set':
      return {
        type: command.type,
        enabled: command.enabled,
        startSample: command.startSample,
        endSample: command.endSample,
        atSample: command.atSample
      }
    case 'event-owner:generation:set':
      return {
        type: command.type,
        clipId: command.clipId,
        generation: command.generation,
        atSample: command.atSample
      }
    case 'event:schedule-beat':
      return {
        type: command.type,
        atSample: command.atSample,
        event: command.event
      }
    case 'event:schedule-beat-batch':
      return {
        type: command.type,
        clipId: command.clipId,
        generation: command.generation,
        events: command.events,
        atSample: command.atSample
      }
    default:
      return {
        type: command.type
      }
  }
}
