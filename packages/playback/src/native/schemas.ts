import type { ClockState } from '../clock.ts'
import type { PlaybackEvent } from '../events.ts'
import type { PlaybackModel } from '../model.ts'

export type NativePlaybackModel = PlaybackModel

export type NativeClockState = ClockState

export type NativePlaybackEvent = PlaybackEvent

export type DeviceCommand =
  | VoiceStartCommand
  | VoiceReleaseCommand
  | VoiceStealCommand
  | ParameterSetCommand
  | PanicCommand

export interface DeviceCommandBase {
  readonly id: string
  readonly type: string
  readonly deviceInstanceId?: string
  readonly trackId?: string
  readonly sourceActionType?: string
  readonly timeMs: number
}

export interface VoiceStartCommand extends DeviceCommandBase {
  readonly type: 'voice:start'
  readonly voiceId: string
  readonly noteId?: string
  readonly pitch: number
  readonly velocity: number
  readonly amplitude?: number
  readonly envelope?: {
    readonly attack: number
    readonly decay: number
    readonly sustain: number
    readonly release: number
  }
  readonly glide?: {
    readonly startPitch: number
    readonly time: number
  }
}

export interface VoiceReleaseCommand extends DeviceCommandBase {
  readonly type: 'voice:release'
  readonly voiceId: string
}

export interface VoiceStealCommand extends DeviceCommandBase {
  readonly type: 'voice:steal'
  readonly voiceId: string
}

export interface ParameterSetCommand extends DeviceCommandBase {
  readonly type: 'parameter:set'
  readonly parameterKey: string
  readonly value: number | boolean | string
}

export interface PanicCommand extends DeviceCommandBase {
  readonly type: 'panic'
}

export interface NativeAudioCommandAck {
  readonly commandId: string
  readonly type: DeviceCommand['type']
  readonly accepted: boolean
}
