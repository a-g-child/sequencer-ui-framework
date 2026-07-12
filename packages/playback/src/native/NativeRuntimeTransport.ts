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
    readonly pendingTransfers: number
    readonly successfulSwaps: number
    readonly rejectedSwaps: number
  }
  readonly diagnostics?: {
    readonly xruns: number
    readonly queueOverflows: number
    readonly streamErrors: number
  }
  readonly telemetry: {
    readonly samplePosition: number
    readonly callbackCount: number
    readonly sampleRate: number
    readonly callbackFrames: number
    readonly outputChannels: number
    readonly plan?: {
      readonly activePlanId: number | null
      readonly activeRevision: number | null
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

export interface NativeRuntimeTransport {
  start(): Promise<NativeSessionCapabilities>
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

export class RendererNativeRuntimeTransport implements NativeRuntimeTransport {
  private get api(): NativeRuntimeTransport {
    const api = (globalThis as { nativeRuntime?: NativeRuntimeTransport })
      .nativeRuntime

    if (!api) {
      throw new Error('Native playback requires the desktop host.')
    }

    return api
  }

  start(): Promise<NativeSessionCapabilities> {
    return this.api.start()
  }

  listAudioDevices(driver: NativeAudioDriver): Promise<NativeAudioDeviceInfo[]> {
    return this.api.listAudioDevices(driver)
  }

  startAudio(request: NativeAudioStartRequest): Promise<NativeActiveStreamInfo> {
    return this.api.startAudio(request)
  }

  stopAudio(): Promise<void> {
    return this.api.stopAudio()
  }

  preparePlan(plan: unknown): Promise<NativePreparedPlanHandle> {
    return this.api.preparePlan(plan)
  }

  activatePlan(
    transferId: number,
    requestedSample?: number
  ): Promise<NativePlanActivation> {
    return this.api.activatePlan(transferId, requestedSample)
  }

  sendCommands(
    commands: readonly EngineCommand[]
  ): Promise<readonly NativeEngineCommandResponse[]> {
    return this.api.sendCommands(commands)
  }

  getSnapshot(): Promise<NativeEngineSnapshot> {
    return this.api.getSnapshot()
  }

  dispose(): Promise<void> {
    return this.api.dispose()
  }
}
