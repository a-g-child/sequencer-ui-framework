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
    return this.client.preparePlan(plan)
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
