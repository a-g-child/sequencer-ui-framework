import type {
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
import { NodeNativeRuntimeTransport } from './NodeNativeRuntimeTransport.ts'

export interface NativeRuntimeManagerOptions {
  readonly transportFactory?: () => NodeNativeRuntimeTransport
}

export class NativeRuntimeManager implements NativeRuntimeTransport {
  private readonly transportFactory: () => NodeNativeRuntimeTransport
  private transport: NodeNativeRuntimeTransport | undefined

  constructor(options: NativeRuntimeManagerOptions = {}) {
    this.transportFactory = options.transportFactory ?? (() => new NodeNativeRuntimeTransport())
  }

  async start(options?: NativeRuntimeStartOptions): Promise<NativeSessionCapabilities> {
    if (this.transport) {
      throw new Error('Native runtime already started.')
    }

    const transport = this.transportFactory()

    try {
      const capabilities = await transport.start(options)
      this.transport = transport
      return capabilities
    } catch (error) {
      await transport.dispose().catch(() => undefined)
      throw error
    }
  }

  private requireTransport(): NodeNativeRuntimeTransport {
    if (!this.transport) {
      throw new Error('Native runtime is not started.')
    }

    return this.transport
  }

  async listAudioDevices(driver: NativeAudioDriver): Promise<NativeAudioDeviceInfo[]> {
    return this.requireTransport().listAudioDevices(driver)
  }

  async startAudio(request: NativeAudioStartRequest): Promise<NativeActiveStreamInfo> {
    return this.requireTransport().startAudio(request)
  }

  async stopAudio(): Promise<void> {
    await this.requireTransport().stopAudio()
  }

  async preparePlan(plan: unknown): Promise<NativePreparedPlanHandle> {
    return this.requireTransport().preparePlan(plan)
  }

  async activatePlan(
    transferId: number,
    requestedSample?: number
  ): Promise<NativePlanActivation> {
    return this.requireTransport().activatePlan(transferId, requestedSample)
  }

  async sendCommands(
    commands: Parameters<NodeNativeRuntimeTransport['sendCommands']>[0]
  ): Promise<readonly NativeEngineCommandResponse[]> {
    return this.requireTransport().sendCommands(commands)
  }

  async getSnapshot(): Promise<NativeEngineSnapshot> {
    return this.requireTransport().getSnapshot()
  }

  async dispose(): Promise<void> {
    const transport = this.transport
    this.transport = undefined

    if (!transport) {
      return
    }

    await transport.dispose().catch(() => undefined)
  }
}
