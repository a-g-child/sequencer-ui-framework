import type { NativeExecutionPlan } from '@sequencer/audio-graph'
import type { PlaybackOutput } from '../output/PlaybackOutput.ts'
import type { EngineCommand } from './schemas.ts'
import type { RuntimeSnapshot } from './RuntimeTypes.ts'
import {
  type NativeAudioStartRequest,
  type NativeRuntimeCapabilities,
  type NativeRuntimeTransport,
  RendererNativeRuntimeTransport
} from './NativeRuntimeTransport.ts'

export interface WebAudioPreparedRuntimeHandle {
  readonly id: string
  readonly planId: string
  readonly backend: 'web-audio'
}

export interface NativePreparedRuntimeHandle {
  readonly id: string
  readonly planId: string
  readonly backend: 'native'
  readonly transferId: number
  readonly revision: number
  readonly ownerId: string
}

export type PreparedRuntimeHandle =
  | WebAudioPreparedRuntimeHandle
  | NativePreparedRuntimeHandle

export interface NativeDiagnosticExecutionPlan {
  readonly kind: 'diagnostic-tone'
  readonly version: 1
  readonly planId: number
  readonly planRevision: number
  readonly frequencyHz: number
  readonly gain: number
  readonly outputChannels: number
}

export type RuntimeCompilePlan = NativeExecutionPlan | NativeDiagnosticExecutionPlan

export interface RuntimeBackend {
  start(): Promise<void>
  stop(): Promise<void>
  compile(plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle>
  activate(handle: PreparedRuntimeHandle): Promise<void>
  sendCommands(commands: readonly EngineCommand[]): void
  getSnapshot(): Promise<RuntimeSnapshot>
  dispose(): Promise<void>
}

export type RuntimeBackendKind = 'web-audio' | 'native'

export interface RuntimeBackendFactoryOptions {
  readonly kind: RuntimeBackendKind
  readonly webAudioOutput?: PlaybackOutput
  readonly native?: NativeBackendOptions
}

export function createRuntimeBackend(
  options: RuntimeBackendFactoryOptions
): RuntimeBackend {
  switch (options.kind) {
    case 'native':
      return new NativeBackend(options.native)
    case 'web-audio':
      return new WebAudioBackend(options.webAudioOutput)
  }
}

export class WebAudioBackend implements RuntimeBackend {
  private readonly output: PlaybackOutput | undefined
  private activePlan?: NativeExecutionPlan
  private running = false

  constructor(output?: PlaybackOutput) {
    this.output = output
  }

  async start(): Promise<void> {
    if (!this.output) {
      throw new Error('WebAudioBackend requires a PlaybackOutput instance')
    }

    await this.output.connect()
    this.running = true
  }

  async stop(): Promise<void> {
    this.output?.panic?.()
    this.running = false
  }

  async compile(plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    const webPlan = plan as NativeExecutionPlan

    return {
      id: `web-audio:${webPlan.id}`,
      planId: webPlan.id,
      backend: 'web-audio'
    }
  }

  async activate(handle: PreparedRuntimeHandle): Promise<void> {
    if (handle.backend !== 'web-audio') {
      throw new Error('WebAudioBackend cannot activate a native prepared handle')
    }

    this.activePlan = { id: handle.planId } as NativeExecutionPlan
  }

  sendCommands(commands: readonly EngineCommand[]): void {
    for (const command of commands) {
      if (command.type === 'transport:start') {
        this.running = true
      } else if (command.type === 'transport:stop' || command.type === 'panic') {
        this.running = false
      }
    }
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    return {
      backend: 'web-audio',
      transport: {
        playing: this.running,
        samplePosition: 0,
        beatPosition: 0,
        loopIteration: 0
      },
      stream: {
        sampleRate: 0,
        callbackCount: 0
      },
      plan: {
        activePlanId: null,
        activeRevision: null,
        pendingTransfers: 0
      },
      diagnostics: {
        xruns: 0,
        queueOverflows: 0
      },
      samplePosition: 0,
      sampleRate: 0,
      running: this.running && Boolean(this.activePlan)
    }
  }

  async dispose(): Promise<void> {
    await this.output?.disconnect()
    this.running = false
    this.activePlan = undefined
  }
}

export interface NativeBackendOptions {
  readonly transport?: NativeRuntimeTransport
  readonly audio?: NativeAudioStartRequest
}

export class NativeBackend implements RuntimeBackend {
  private static nextBackendId = 1

  private readonly backendId = `native:${NativeBackend.nextBackendId++}`
  private readonly transport: NativeRuntimeTransport
  private readonly audio: NativeAudioStartRequest
  private readonly preparedHandles = new Set<number>()
  private readonly consumedHandles = new Set<number>()
  private capabilities?: NativeRuntimeCapabilities
  private running = false
  private pendingCommands: Promise<void> = Promise.resolve()
  private commandFailure: unknown

  constructor(options: NativeBackendOptions = {}) {
    this.transport = options.transport ?? new RendererNativeRuntimeTransport()
    this.audio = options.audio ?? {
      driver: 'null',
      sampleRate: 48_000,
      bufferFrames: 128,
      channels: 2
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    const session = await this.transport.start(this.audio)

    this.capabilities = session.capabilities
    await this.transport.startAudio(this.audio)
    this.running = true
  }

  async stop(): Promise<void> {
    await this.flushCommands()
    await this.transport.stopAudio()
    this.running = false
  }

  async compile(plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    if (!this.running) {
      throw new Error('NativeBackend must be started before compiling a plan')
    }

    if (!isNativeDiagnosticExecutionPlan(plan) && !isNativeExecutionPlan(plan)) {
      throw new Error(
        'NativeBackend.compile currently accepts NativeExecutionPlan or NativeDiagnosticExecutionPlan wire plans'
      )
    }

    const handle = await this.transport.preparePlan(plan)

    this.preparedHandles.add(handle.transferId)

    return {
      id: `native:${handle.transferId}`,
      planId: String(handle.planId),
      backend: 'native',
      transferId: handle.transferId,
      revision: handle.revision,
      ownerId: this.backendId
    }
  }

  async activate(handle: PreparedRuntimeHandle): Promise<void> {
    if (handle.backend !== 'native') {
      throw new Error('NativeBackend cannot activate a WebAudio prepared handle')
    }
    if (handle.ownerId !== this.backendId) {
      throw new Error('prepared handle belongs to a different NativeBackend')
    }
    if (this.consumedHandles.has(handle.transferId)) {
      throw new Error('prepared handle has already been consumed')
    }
    if (!this.preparedHandles.has(handle.transferId)) {
      throw new Error('prepared handle is unknown')
    }

    await this.flushCommands()
    const snapshot = await this.transport.getSnapshot()
    const requestedSample =
      snapshot.transport?.samplePosition ?? snapshot.telemetry?.samplePosition ?? 0

    await this.transport.activatePlan(handle.transferId, requestedSample)
    this.preparedHandles.delete(handle.transferId)
    this.consumedHandles.add(handle.transferId)
  }

  sendCommands(commands: readonly EngineCommand[]): void {
    const nativeCommands = commands.filter(isNativeRuntimeCommand)

    if (nativeCommands.length > 0) {
      const nextCommands = this.pendingCommands
        .catch(() => undefined)
        .then(() => this.transport.sendCommands(nativeCommands))
        .then(() => undefined)

      this.pendingCommands = nextCommands
      void nextCommands.catch((error) => {
        this.commandFailure = error
      })
    }
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    await this.flushCommands()
    const snapshot = await this.transport.getSnapshot()

    return {
      backend: 'native',
      transport: {
        playing: snapshot.transport?.playing ?? false,
        samplePosition:
          snapshot.transport?.samplePosition ?? snapshot.telemetry?.samplePosition ?? 0,
        beatPosition: snapshot.transport?.beatPosition ?? 0,
        loopIteration: snapshot.transport?.loopIteration ?? 0
      },
      stream: {
        sampleRate: snapshot.telemetry?.sampleRate ?? snapshot.stream?.sampleRate ?? 0,
        callbackCount: snapshot.telemetry?.callbackCount ?? 0
      },
      plan: {
        activePlanId:
          snapshot.plan?.activePlanId ??
          snapshot.telemetry?.plan?.activePlanId ??
          null,
        activeRevision:
          snapshot.plan?.activeRevision ??
          snapshot.telemetry?.plan?.activeRevision ??
          null,
        pendingTransfers:
          snapshot.plan?.pendingTransfers ??
          snapshot.telemetry?.plan?.pendingPlanCount ??
          0
      },
      diagnostics: {
        xruns: snapshot.diagnostics?.xruns ?? 0,
        queueOverflows: snapshot.diagnostics?.queueOverflows ?? 0
      },
      samplePosition:
        snapshot.transport?.samplePosition ?? snapshot.telemetry?.samplePosition ?? 0,
      sampleRate: snapshot.telemetry?.sampleRate ?? snapshot.stream?.sampleRate ?? 0,
      running: this.running,
      native: snapshot
    }
  }

  async dispose(): Promise<void> {
    await this.pendingCommands.catch(() => undefined)
    await this.transport.dispose()
    this.running = false
    this.preparedHandles.clear()
    this.consumedHandles.clear()
  }

  private async flushCommands(): Promise<void> {
    await this.pendingCommands.catch(() => undefined)

    if (this.commandFailure) {
      const error = this.commandFailure
      this.commandFailure = undefined
      throw error
    }
  }

  get negotiatedCapabilities(): NativeRuntimeCapabilities | undefined {
    return this.capabilities
  }
}

export function createDiagnosticNativeExecutionPlan(
  options: Partial<Omit<NativeDiagnosticExecutionPlan, 'kind' | 'version'>> = {}
): NativeDiagnosticExecutionPlan {
  return {
    kind: 'diagnostic-tone',
    version: 1,
    planId: options.planId ?? 1,
    planRevision: options.planRevision ?? 1,
    frequencyHz: options.frequencyHz ?? 440,
    gain: options.gain ?? 0.05,
    outputChannels: options.outputChannels ?? 2
  }
}

function isNativeDiagnosticExecutionPlan(
  plan: RuntimeCompilePlan
): plan is NativeDiagnosticExecutionPlan {
  return (
    typeof (plan as NativeDiagnosticExecutionPlan).kind === 'string' &&
    (plan as NativeDiagnosticExecutionPlan).kind === 'diagnostic-tone'
  )
}

function isNativeExecutionPlan(plan: RuntimeCompilePlan): plan is NativeExecutionPlan {
  return (
    typeof (plan as NativeExecutionPlan).id === 'string' &&
    typeof (plan as NativeExecutionPlan).graphId === 'string' &&
    Array.isArray((plan as NativeExecutionPlan).nodes)
  )
}

function isNativeRuntimeCommand(command: EngineCommand): boolean {
  return (
    command.type === 'transport:start' ||
    command.type === 'transport:stop' ||
    command.type === 'panic' ||
    command.type === 'tempo-map:set' ||
    command.type === 'transport-loop:set' ||
    command.type === 'event:schedule-beat' ||
    command.type === 'event:schedule-beat-batch'
  )
}
