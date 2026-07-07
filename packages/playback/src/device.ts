import {
  DeviceRegistry,
  RuntimeDeviceRegistry,
  getRuntimeParameter,
  setRuntimeParameterValue,
  type DeviceFactory,
  type DeviceInstance,
  type DeviceParameterValue,
  type RuntimeDevice
} from '@sequencer/device'
import type { VoiceAction } from '@sequencer/audio'
import type { PlaybackEvent } from './events'
import type { DeviceCommand } from './native/schemas.ts'
import { voiceActionsToDeviceCommands } from './native/voice-action-commands.ts'

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

export interface PlaybackDeviceProcessResult {
  readonly voiceActions: VoiceAction[]
  readonly deviceCommands: DeviceCommand[]
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

  panic(): void {
    for (const device of this.runtimeDevices.values()) {
      if (hasPanic(device)) {
        device.panic()
      }
    }
  }

  advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return

    for (const device of this.runtimeDevices.values()) {
      if (hasAdvance(device)) {
        device.advance(deltaMs)
      }
    }
  }

  setRuntimeParameterValue(
    deviceInstanceId: string,
    parameterKey: string,
    value: DeviceParameterValue
  ): boolean {
    const device = this.runtimeDevices.find(deviceInstanceId)
    const parameter = device
      ? getRuntimeParameter(device.parameters, parameterKey)
      : undefined

    if (!parameter) return false

    setRuntimeParameterValue(parameter, value)
    return true
  }

  processEvents(events: readonly PlaybackEvent[]): PlaybackDeviceProcessResult {
    const voiceActions: VoiceAction[] = []
    const deviceCommands: DeviceCommand[] = []

    if (events.length === 0) {
      return { voiceActions, deviceCommands }
    }

    for (const device of this.runtimeDevices.values()) {
      const deviceEvents = events.filter(
        (event) => event.destination?.deviceInstanceId === device.instanceId
      )

      if (deviceEvents.length === 0) continue

      device.processEvents(deviceEvents)

      if (hasVoiceActions(device)) {
        const actions = device.consumeVoiceActions()

        voiceActions.push(...actions)
        deviceCommands.push(...voiceActionsToDeviceCommands(actions, device.instanceId))
      }
    }

    return { voiceActions, deviceCommands }
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

function hasPanic(
  device: PlaybackRuntimeDevice
): device is PlaybackRuntimeDevice & {
  panic(): void
} {
  return (
    'panic' in device &&
    typeof device.panic === 'function'
  )
}

function hasAdvance(
  device: PlaybackRuntimeDevice
): device is PlaybackRuntimeDevice & {
  advance(deltaMs: number): void
} {
  return (
    'advance' in device &&
    typeof device.advance === 'function'
  )
}
