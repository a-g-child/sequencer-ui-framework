import {
  DeviceRegistry,
  RuntimeDeviceRegistry,
  type DeviceFactory,
  type DeviceInstance,
  type RuntimeDevice
} from '@sequencer/device'
import type { VoiceAction } from '@sequencer/audio'
import type { PlaybackEvent } from './events'

export type PlaybackRuntimeDevice = RuntimeDevice<PlaybackEvent>
export type PlaybackDeviceFactory = DeviceFactory<PlaybackEvent>

export interface PlaybackDeviceManagerStatus {
  readonly registeredDeviceCount: number
  readonly runtimeDeviceCount: number
  readonly missingDeviceCount: number
  readonly connectedDeviceCount: number
}

export interface PlaybackDeviceDiagnostics {
  readonly id: string
  readonly status: PlaybackRuntimeDevice['status']
  readonly diagnostics?: unknown
}

export class PlaybackDeviceManager {
  readonly devices = new DeviceRegistry<PlaybackEvent>()
  readonly runtimeDevices = new RuntimeDeviceRegistry<PlaybackEvent>()

  get status(): PlaybackDeviceManagerStatus {
    const runtimeDevices = this.runtimeDevices.values()

    return {
      registeredDeviceCount: this.devices.descriptors().length,
      runtimeDeviceCount: runtimeDevices.length,
      missingDeviceCount: runtimeDevices.filter(
        (device) => device.status === 'missing'
      ).length,
      connectedDeviceCount: runtimeDevices.filter(
        (device) => device.status === 'connected'
      ).length
    }
  }

  register(factory: PlaybackDeviceFactory): PlaybackDeviceFactory {
    return this.devices.register(factory)
  }

  buildFromInstances(
    instances: readonly DeviceInstance[]
  ): readonly PlaybackRuntimeDevice[] {
    this.runtimeDevices.clear()

    for (const instance of instances) {
      this.runtimeDevices.add(this.devices.createRuntimeDevice(instance))
    }

    return this.runtimeDevices.values()
  }

  async connectAll(): Promise<void> {
    for (const device of this.runtimeDevices.values()) {
      await device.connect()
    }
  }

  async disconnectAll(): Promise<void> {
    for (const device of this.runtimeDevices.values()) {
      await device.disconnect()
    }
  }

  processEvents(events: readonly PlaybackEvent[]): VoiceAction[] {
    const voiceActions: VoiceAction[] = []

    if (events.length === 0) return voiceActions

    for (const device of this.runtimeDevices.values()) {
      const deviceEvents = events.filter(
        (event) => event.destination?.deviceInstanceId === device.instanceId
      )

      if (deviceEvents.length === 0) continue

      device.processEvents(deviceEvents)

      if (hasVoiceActions(device)) {
        voiceActions.push(...device.consumeVoiceActions())
      }
    }

    return voiceActions
  }

  getDiagnostics(): PlaybackDeviceDiagnostics[] {
    return this.runtimeDevices.values().map((device) => ({
      id: device.instanceId,
      status: device.status,
      diagnostics: hasDiagnostics(device) ? device.getDiagnostics() : undefined
    }))
  }
}

function hasVoiceActions(
  device: PlaybackRuntimeDevice
): device is PlaybackRuntimeDevice & {
  consumeVoiceActions(): VoiceAction[]
} {
  return (
    'consumeVoiceActions' in device &&
    typeof device.consumeVoiceActions === 'function'
  )
}

function hasDiagnostics(
  device: PlaybackRuntimeDevice
): device is PlaybackRuntimeDevice & {
  getDiagnostics(): unknown
} {
  return (
    'getDiagnostics' in device &&
    typeof device.getDiagnostics === 'function'
  )
}
