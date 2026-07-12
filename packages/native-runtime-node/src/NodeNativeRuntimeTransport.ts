import {
  NativeSessionClient,
  type NativeSessionClientOptions
} from './NativeSessionClient.ts'
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
  NativeRuntimeStartOptions,
  NativeRuntimeTransport,
  NativeSessionCapabilities
} from '@sequencer/playback'

export interface NodeNativeRuntimeTransportOptions
  extends NativeSessionClientOptions {
  readonly client?: NativeSessionClient
}

export class NodeNativeRuntimeTransport implements NativeRuntimeTransport {
  private readonly client: NativeSessionClient

  constructor(options: NodeNativeRuntimeTransportOptions = {}) {
    this.client = options.client ?? new NativeSessionClient(options)
  }

  start(options?: NativeRuntimeStartOptions): Promise<NativeSessionCapabilities> {
    return this.client.start(options)
  }

  listAudioDevices(driver: NativeAudioDriver): Promise<NativeAudioDeviceInfo[]> {
    return this.client.listAudioDevices(driver)
  }

  startAudio(request: NativeAudioStartRequest): Promise<NativeActiveStreamInfo> {
    return this.client.startAudio(request)
  }

  stopAudio(): Promise<void> {
    return this.client.stopAudio()
  }

  preparePlan(plan: unknown): Promise<NativePreparedPlanHandle> {
    return this.client.preparePlan(toEngineHostPlan(plan))
  }

  activatePlan(
    transferId: number,
    requestedSample = 0
  ): Promise<NativePlanActivation> {
    return this.client.activatePlan(transferId, requestedSample)
  }

  async sendCommands(
    commands: readonly EngineCommand[]
  ): Promise<readonly NativeEngineCommandResponse[]> {
    const responses: NativeEngineCommandResponse[] = []

    for (const command of commands) {
      responses.push(await this.client.sendEngineCommand(command))
    }

    return responses
  }

  getSnapshot(): Promise<NativeEngineSnapshot> {
    return this.client.getSnapshot()
  }

  async dispose(): Promise<void> {
    await this.client.shutdown()
  }
}

type AppNativeExecutionPlan = {
  readonly id?: unknown
  readonly graphId?: unknown
  readonly revision?: unknown
  readonly nodes?: readonly {
    readonly nodeId?: unknown
    readonly descriptorId?: unknown
  }[]
  readonly parameters?: readonly {
    readonly nodeId?: unknown
    readonly parameterId?: unknown
    readonly defaultValue?: unknown
  }[]
}

type EngineHostInstrumentPlan = {
  readonly version: 1
  readonly kind: 'instrument-gain-output'
  readonly planId: number
  readonly planRevision: number
  readonly gain: number
  readonly voiceCount: number
  readonly outputChannels: number
}

function toEngineHostPlan(plan: unknown): unknown {
  if (isDiagnosticPlan(plan) || isEngineHostPlan(plan)) {
    return plan
  }

  if (!isAppNativeExecutionPlan(plan)) {
    return plan
  }

  assertSupportedInstrumentGraph(plan)

  return {
    version: 1,
    kind: 'instrument-gain-output',
    planId: stableNumericId(String(plan.id ?? plan.graphId ?? 'native-plan')),
    planRevision: numericRevision(plan.revision),
    gain: gainValue(plan),
    voiceCount: 8,
    outputChannels: 2
  } satisfies EngineHostInstrumentPlan
}

function isDiagnosticPlan(plan: unknown): boolean {
  return (
    Boolean(plan) &&
    typeof plan === 'object' &&
    (plan as { kind?: unknown }).kind === 'diagnostic-tone'
  )
}

function isEngineHostPlan(plan: unknown): boolean {
  return (
    Boolean(plan) &&
    typeof plan === 'object' &&
    (plan as { kind?: unknown }).kind === 'instrument-gain-output'
  )
}

function isAppNativeExecutionPlan(plan: unknown): plan is AppNativeExecutionPlan {
  return (
    Boolean(plan) &&
    typeof plan === 'object' &&
    Array.isArray((plan as AppNativeExecutionPlan).nodes)
  )
}

function assertSupportedInstrumentGraph(plan: AppNativeExecutionPlan): void {
  const descriptors = new Set(
    (plan.nodes ?? []).map((node) => String(node.descriptorId ?? ''))
  )

  for (const descriptorId of [
    'sequencer.source.midi-input',
    'sequencer.source.oscillator',
    'sequencer.processor.gain',
    'sequencer.output.audio-out'
  ]) {
    if (!descriptors.has(descriptorId)) {
      throw new Error(
        `unsupported native project plan: missing ${descriptorId}`
      )
    }
  }
}

function numericRevision(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : 1
}

function gainValue(plan: AppNativeExecutionPlan): number {
  const gainNodeIds = new Set(
    (plan.nodes ?? [])
      .filter((node) => node.descriptorId === 'sequencer.processor.gain')
      .map((node) => String(node.nodeId ?? ''))
  )
  const gainParameter = (plan.parameters ?? []).find(
    (parameter) =>
      gainNodeIds.has(String(parameter.nodeId ?? '')) &&
      parameter.parameterId === 'gain' &&
      typeof parameter.defaultValue === 'number'
  )

  return typeof gainParameter?.defaultValue === 'number'
    ? clamp(gainParameter.defaultValue, 0, 4)
    : 0.25
}

function stableNumericId(value: string): number {
  let hash = 5381

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }

  return (hash >>> 0) || 1
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
