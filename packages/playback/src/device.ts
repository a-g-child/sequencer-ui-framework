import {
  DeviceRegistry,
  RuntimeDeviceRegistry,
  clearRuntimeParameterModulation,
  getRuntimeParameter,
  setRuntimeParameterModulation,
  setRuntimeParameterValue,
  type DeviceFactory,
  type DeviceInstance,
  type DeviceParameterValue,
  type RuntimeDevice
} from '@sequencer/device'
import type { SampleVoiceAction, VoiceAction } from '@sequencer/audio'
import type { PlaybackEvent } from './events'
import type { PlaybackTrack } from './model'
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
  readonly sampleActions: SampleVoiceAction[]
  readonly deviceCommands: DeviceCommand[]
}

export class PlaybackDeviceManager {
  readonly devices = new DeviceRegistry<PlaybackEvent>()
  readonly runtimeDevices = new RuntimeDeviceRegistry<PlaybackEvent>()
  private readonly deviceChainsByTrackId = new Map<string, readonly string[]>()

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

  configureTrackDeviceChains(tracks: readonly PlaybackTrack[]): void {
    this.deviceChainsByTrackId.clear()

    for (const track of tracks) {
      const chain = track.deviceInstanceIds && track.deviceInstanceIds.length > 0
        ? track.deviceInstanceIds
        : track.deviceInstanceId
          ? [track.deviceInstanceId]
          : []

      if (chain.length > 0) {
        this.deviceChainsByTrackId.set(track.id, chain)
      }
    }
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

  advance(deltaMs: number, bpm?: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return

    for (const device of this.runtimeDevices.values()) {
      if (hasAdvance(device)) {
        device.advance(deltaMs, { bpm })
      }
    }

    this.applyRuntimeModulations()
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
    const sampleActions: SampleVoiceAction[] = []
    const deviceCommands: DeviceCommand[] = []

    if (events.length === 0) {
      return { voiceActions, sampleActions, deviceCommands }
    }

    for (const eventGroup of groupEventsByRoute(
      events,
      (event) => this.routeForEvent(event)
    )) {
      let currentEvents: readonly PlaybackEvent[] = eventGroup.events
      const route = eventGroup.route

      for (const deviceInstanceId of route) {
        if (currentEvents.length === 0) break

        const device = this.runtimeDevices.find(deviceInstanceId)

        if (!device) {
          currentEvents = []
          break
        }

        const deviceEvents = currentEvents.map((currentEvent) =>
          routeEventToDevice(currentEvent, deviceInstanceId)
        )

        device.processEvents(deviceEvents)

        if (hasVoiceActions(device)) {
          const actions = device.consumeVoiceActions()

          voiceActions.push(...actions)
          deviceCommands.push(...voiceActionsToDeviceCommands(actions, device.instanceId))
        }

        if (hasSampleActions(device)) {
          sampleActions.push(...device.consumeSampleActions())
        }

        currentEvents = hasPlaybackEvents(device)
          ? device.consumePlaybackEvents()
          : []
      }
    }

    return { voiceActions, sampleActions, deviceCommands }
  }

  getDiagnostics(): PlaybackDeviceDiagnostics[] {
    return this.runtimeDevices.values().map((device) => ({
      id: device.instanceId,
      status: device.status,
      diagnostics: hasDiagnostics(device) ? device.getDiagnostics() : undefined
    }))
  }

  private routeForEvent(event: PlaybackEvent): readonly string[] {
    const trackId = event.destination?.trackId ?? event.trackId
    const chain = trackId ? this.deviceChainsByTrackId.get(trackId) : undefined

    if (chain && chain.length > 0) return chain

    return event.destination?.deviceInstanceId
      ? [event.destination.deviceInstanceId]
      : []
  }

  private applyRuntimeModulations(): void {
    for (const device of this.runtimeDevices.values()) {
      for (const parameter of device.parameters) {
        if (typeof parameter.value === 'number') {
          clearRuntimeParameterModulation(parameter)
        }
      }
    }

    for (const device of this.runtimeDevices.values()) {
      if (!hasModulation(device)) continue

      const modulation = device.consumeModulation()

      if (!modulation) continue

      const targetDevice = this.runtimeDevices.find(modulation.deviceInstanceId)
      const targetParameter = targetDevice
        ? getRuntimeParameter(targetDevice.parameters, modulation.parameterKey)
        : undefined

      if (!targetParameter || typeof targetParameter.value !== 'number') continue

      setRuntimeParameterModulation(targetParameter, modulation.value)
    }
  }
}

function groupEventsByRoute(
  events: readonly PlaybackEvent[],
  routeForEvent: (event: PlaybackEvent) => readonly string[]
): {
  readonly route: readonly string[]
  readonly events: PlaybackEvent[]
}[] {
  const groups: {
    route: readonly string[]
    events: PlaybackEvent[]
  }[] = []
  const groupsByRouteKey = new Map<string, (typeof groups)[number]>()

  for (const event of events) {
    const route = routeForEvent(event)
    const routeKey = route.join('\0')
    const existingGroup = groupsByRouteKey.get(routeKey)

    if (existingGroup) {
      existingGroup.events.push(event)
      continue
    }

    const group = {
      route,
      events: [event]
    }

    groupsByRouteKey.set(routeKey, group)
    groups.push(group)
  }

  return groups
}

function routeEventToDevice(
  event: PlaybackEvent,
  deviceInstanceId: string
): PlaybackEvent {
  return {
    ...event,
    destination: {
      ...event.destination,
      trackId: event.destination?.trackId ?? event.trackId,
      deviceInstanceId
    }
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

function hasSampleActions(
  device: PlaybackRuntimeDevice
): device is PlaybackRuntimeDevice & {
  consumeSampleActions(): SampleVoiceAction[]
} {
  return (
    'consumeSampleActions' in device &&
    typeof device.consumeSampleActions === 'function'
  )
}

function hasPlaybackEvents(
  device: PlaybackRuntimeDevice
): device is PlaybackRuntimeDevice & {
  consumePlaybackEvents(): PlaybackEvent[]
} {
  return (
    'consumePlaybackEvents' in device &&
    typeof device.consumePlaybackEvents === 'function'
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
  advance(deltaMs: number, context?: { readonly bpm?: number }): void
} {
  return (
    'advance' in device &&
    typeof device.advance === 'function'
  )
}

function hasModulation(
  device: PlaybackRuntimeDevice
): device is PlaybackRuntimeDevice & {
  consumeModulation(): {
    readonly deviceInstanceId: string
    readonly parameterKey: string
    readonly value: number
  } | undefined
} {
  return (
    'consumeModulation' in device &&
    typeof device.consumeModulation === 'function'
  )
}
