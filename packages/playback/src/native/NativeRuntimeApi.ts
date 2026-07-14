import type { EngineCommand } from './schemas.ts'
import type { RuntimeSnapshot } from './RuntimeTypes.ts'
import type {
  NativeActiveStreamInfo,
  NativeAudioDeviceInfo,
  NativeAudioDriver,
  NativeAudioStartRequest,
  NativeEngineCommandResponse,
  NativeEngineSnapshot,
  NativePlanActivation,
  NativePreparedPlanHandle,
  NativeRuntimeCapabilities,
  NativeRuntimeTransport,
  NativeSessionCapabilities
} from './NativeRuntimeTransport.ts'
import { toEngineHostPlan } from './EngineHostPlan.ts'

export interface NativeRuntimeStartOptions {
  readonly driver?: NativeAudioDriver
  readonly device?: string
  readonly sampleRate?: number
  readonly bufferFrames?: number
  readonly channels?: number
}

export interface NativeRuntimeApi {
  start(options: NativeRuntimeStartOptions): Promise<NativeRuntimeCapabilities>
  preparePlan(plan: unknown): Promise<NativePreparedPlanHandle>
  activatePlan(
    handle: NativePreparedPlanHandle,
    requestedSample?: number
  ): Promise<NativePlanActivation>
  sendCommands(commands: readonly EngineCommand[]): Promise<void>
  getSnapshot(): Promise<RuntimeSnapshot>
  stopAudio(): Promise<void>
  dispose(): Promise<void>
}

export class NativeRuntimeBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'NativeRuntimeBridgeError'
  }
}

export interface NativeRuntimeBridgeRequest {
  readonly type: string
  readonly payload?: unknown
}

export type NativeRuntimeBridgeInvoker = (
  channel: string,
  payload: unknown
) => Promise<unknown>

export function createNativeRuntimePreloadApi(
  invoke: NativeRuntimeBridgeInvoker
): NativeRuntimeApi {
  return {
    async start(options) {
      return (await invoke('native-runtime:start', options)) as NativeRuntimeCapabilities
    },
    async preparePlan(plan) {
      return (await invoke('native-runtime:preparePlan', plan)) as NativePreparedPlanHandle
    },
    async activatePlan(handle, requestedSample) {
      return (await invoke('native-runtime:activatePlan', {
        handle,
        requestedSample
      })) as NativePlanActivation
    },
    async sendCommands(commands) {
      await invoke('native-runtime:sendCommands', commands)
    },
    async getSnapshot() {
      return (await invoke('native-runtime:getSnapshot', undefined)) as RuntimeSnapshot
    },
    async stopAudio() {
      await invoke('native-runtime:stopAudio', undefined)
    },
    async dispose() {
      await invoke('native-runtime:dispose', undefined)
    }
  }
}

export function installNativeRuntimeApi(api: NativeRuntimeApi): void {
  ;(globalThis as { nativeRuntime?: NativeRuntimeApi }).nativeRuntime = api
}

export interface RendererNativeRuntimeTransportOptions {
  readonly api?: NativeRuntimeApi
}

export class RendererNativeRuntimeTransport implements NativeRuntimeTransport {
  private readonly api: NativeRuntimeApi | undefined

  constructor(options: RendererNativeRuntimeTransportOptions = {}) {
    this.api = options.api
  }

  private getRuntimeApi(): NativeRuntimeApi {
    return this.api ?? getGlobalNativeRuntimeApi()
  }

  async start(options?: NativeRuntimeStartOptions): Promise<NativeSessionCapabilities> {
    const capabilities = await this.getRuntimeApi().start(options ?? { driver: 'null' })

    return {
      protocolVersion: 1,
      capabilities,
      drivers: ['null'],
      messages: []
    }
  }

  async listAudioDevices(driver: NativeAudioDriver): Promise<NativeAudioDeviceInfo[]> {
    return []
  }

  async startAudio(request: NativeAudioStartRequest): Promise<NativeActiveStreamInfo> {
    return {
      driver: request.driver,
      deviceId: request.device ?? 'null',
      deviceName: request.device ?? 'Null',
      sampleRate: request.sampleRate ?? 48_000,
      channels: request.channels ?? 2,
      sampleFormat: 'f32'
    }
  }

  async stopAudio(): Promise<void> {
    await this.getRuntimeApi().stopAudio()
  }

  async preparePlan(plan: unknown): Promise<NativePreparedPlanHandle> {
    return this.getRuntimeApi().preparePlan(toEngineHostPlan(plan))
  }

  async activatePlan(
    transferId: number,
    requestedSample = 0
  ): Promise<NativePlanActivation> {
    return this.getRuntimeApi().activatePlan(
      { transferId, planId: 0, revision: 0 },
      requestedSample
    )
  }

  async sendCommands(
    commands: readonly EngineCommand[]
  ): Promise<readonly NativeEngineCommandResponse[]> {
    await this.getRuntimeApi().sendCommands(commands)
    return commands.map((_, index) => ({ commandId: index + 1 }))
  }

  async getSnapshot(): Promise<NativeEngineSnapshot> {
    return this.getRuntimeApi().getSnapshot() as unknown as NativeEngineSnapshot
  }

  async dispose(): Promise<void> {
    await this.getRuntimeApi().dispose()
  }
}

function getGlobalNativeRuntimeApi(): NativeRuntimeApi {
  const api = (globalThis as { nativeRuntime?: NativeRuntimeApi }).nativeRuntime

  if (!api) {
    throw new NativeRuntimeBridgeError(
      'native-runtime:not-available',
      'Native playback requires the desktop host.'
    )
  }

  return api
}
