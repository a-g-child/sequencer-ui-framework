import type { VoiceAction } from '@sequencer/audio'
import type { DeviceCommand } from './schemas.ts'

export function voiceActionsToDeviceCommands(
  actions: readonly VoiceAction[],
  deviceInstanceId?: string
): DeviceCommand[] {
  return actions.map((action) => voiceActionToDeviceCommand(action, deviceInstanceId))
}

export function voiceActionToDeviceCommand(
  action: VoiceAction,
  deviceInstanceId?: string
): DeviceCommand {
  const base = {
    id: deviceCommandId(action, deviceInstanceId),
    deviceInstanceId,
    sourceActionType: action.type,
    timeMs: action.timeMs
  }

  if (action.type === 'voice:start') {
    return {
      ...base,
      type: 'voice:start',
      trackId: action.trackId,
      voiceId: action.voiceId,
      noteId: action.noteId,
      pitch: action.pitch,
      velocity: action.velocity,
      amplitude: action.amplitude,
      envelope: action.envelope,
      glide: action.glide
    }
  }

  return {
    ...base,
    type: action.type,
    voiceId: action.voiceId
  }
}

function deviceCommandId(
  action: VoiceAction,
  deviceInstanceId: string | undefined
): string {
  const prefix = deviceInstanceId ? `${deviceInstanceId}:` : ''

  return `${prefix}${action.voiceId}:${action.type}:${action.timeMs}`
}
