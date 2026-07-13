import type { EngineCommand } from './schemas.ts'

export type NativeAudioDriver = 'null' | 'cpal'

export interface NativeRuntimeCapabilities {
  readonly executionPlanVersion: number
  readonly eventGraphVersion: number
  readonly parameterGraphVersion: number
  readonly assets: boolean
  readonly telemetry: boolean
}

export interface NativeSessionCapabilities {
  readonly protocolVersion: number
  readonly capabilities: NativeRuntimeCapabilities
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
  readonly transport?: {
    readonly playing: boolean
    readonly samplePosition: number
    readonly beatPosition: number
    readonly loopIteration: number
  }
  readonly plan?: {
    readonly activePlanId: number | null
    readonly activeRevision: number | null
    readonly planMaximumFrames?: number | null
    readonly pendingTransfers: number
    readonly successfulSwaps: number
    readonly rejectedSwaps: number
  }
  readonly diagnostics?: {
    readonly xruns: number
    readonly queueOverflows: number
    readonly streamErrors: number
    readonly callbackFrames?: number
    readonly maximumCallbackFrames?: number
    readonly commandQueueDepth?: number
    readonly pendingCommandCount?: number
    readonly nextPendingCommandSample?: number | null
    readonly commandReceived?: number
    readonly commandApplied?: number
    readonly commandLate?: number
    readonly commandRejected?: number
    readonly commandOutOfOrder?: number
    readonly lastCommandRejection?: {
      readonly commandId: number
      readonly reason: string
    } | null
  }
  readonly telemetry: {
    readonly samplePosition: number
    readonly callbackCount: number
    readonly sampleRate: number
    readonly callbackFrames: number
    readonly maximumCallbackFrames?: number
    readonly outputChannels: number
    readonly commandQueueDepth?: number
    readonly pendingCommandCount?: number
    readonly nextPendingCommandSample?: number | null
    readonly commandDiagnostics?: {
      readonly received: number
      readonly applied: number
      readonly late: number
      readonly rejected: number
      readonly outOfOrder: number
      readonly commandQueueOverflows: number
      readonly telemetryQueueOverflows: number
    }
    readonly plan?: {
      readonly activePlanId: number | null
      readonly activeRevision: number | null
      readonly planMaximumFrames?: number | null
      readonly pendingPlanCount: number
      readonly successfulSwaps: number
      readonly rejectedSwaps: number
    }
  } | null
}

export interface NativePreparedPlanHandle {
  readonly transferId: number
  readonly planId: number
  readonly revision: number
}

export interface NativePlanActivation {
  readonly planId: number
  readonly revision: number
  readonly requestedSample: number
  readonly appliedSample: number
}

export interface NativeEngineCommandResponse {
  readonly commandId: number
}

export interface NativeRuntimeStartOptions {
  readonly driver?: NativeAudioDriver
  readonly device?: string
  readonly sampleRate?: number
  readonly bufferFrames?: number
  readonly channels?: number
}

export interface NativeRuntimeTransport {
  start(options?: NativeRuntimeStartOptions): Promise<NativeSessionCapabilities>
  listAudioDevices(driver: NativeAudioDriver): Promise<NativeAudioDeviceInfo[]>
  startAudio(request: NativeAudioStartRequest): Promise<NativeActiveStreamInfo>
  stopAudio(): Promise<void>
  preparePlan(plan: unknown): Promise<NativePreparedPlanHandle>
  activatePlan(
    transferId: number,
    requestedSample?: number
  ): Promise<NativePlanActivation>
  sendCommands(
    commands: readonly EngineCommand[]
  ): Promise<readonly NativeEngineCommandResponse[]>
  getSnapshot(): Promise<NativeEngineSnapshot>
  dispose(): Promise<void>
}

export type {
  NativeRuntimeApi,
  NativeRuntimeBridgeInvoker,
  NativeRuntimeBridgeRequest
} from './NativeRuntimeApi.ts'
export {
  createNativeRuntimePreloadApi,
  installNativeRuntimeApi,
  RendererNativeRuntimeTransport,
  NativeRuntimeBridgeError
} from './NativeRuntimeApi.ts'
