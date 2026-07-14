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
  | ParameterRampCommand
  | PanicCommand

export type EngineCommand =
  | DeviceCommand
  | TransportStartCommand
  | TransportStopCommand
  | SeekCommand
  | SetTempoMapCommand
  | SetTransportLoopCommand
  | SetScheduledEventOwnerGenerationCommand
  | ScheduleSampleEventCommand
  | ScheduleBeatEventCommand
  | ScheduleBeatEventBatchCommand
  | PreparedTransportStartCommand
  | LaunchClipCommand
  | ParameterModulateCommand
  | SwapExecutionPlanCommand

export interface DeviceCommandBase {
  readonly id: string
  readonly type: string
  readonly deviceInstanceId?: string
  readonly trackId?: string
  readonly sourceActionType?: string
  readonly reason?: string
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
  readonly atSample?: number
  readonly rampSamples?: number
}

export interface ParameterRampCommand extends DeviceCommandBase {
  readonly type: 'parameter:ramp'
  readonly parameterKey: string
  readonly value: number
  readonly atSample: number
  readonly rampSamples: number
}

export interface ParameterModulateCommand extends DeviceCommandBase {
  readonly type: 'parameter:modulate'
  readonly parameterKey: string
  readonly value: number
  readonly atSample: number
}

export interface TransportStartCommand extends DeviceCommandBase {
  readonly type: 'transport:start'
  readonly atSample: number
}

export interface TransportStopCommand extends DeviceCommandBase {
  readonly type: 'transport:stop'
  readonly atSample: number
}

export interface SeekCommand extends DeviceCommandBase {
  readonly type: 'seek'
  readonly beat: number
}

export interface SetTempoMapCommand extends DeviceCommandBase {
  readonly type: 'tempo-map:set'
  readonly originSample: number
  readonly originBeat: number
  readonly bpm: number
  readonly sampleRate: number
  readonly atSample: number
  readonly snapshotId?: number
}

export interface SetTransportLoopCommand extends DeviceCommandBase {
  readonly type: 'transport-loop:set'
  readonly enabled: boolean
  readonly startSample: number
  readonly endSample: number
  readonly atSample: number
}

export interface SetScheduledEventOwnerGenerationCommand extends DeviceCommandBase {
  readonly type: 'event-owner:generation:set'
  readonly clipId: string
  readonly generation: number
  readonly atSample: number
}

export type NativeScheduledBeatEvent =
  | NativeScheduledBeatNoteOnEvent
  | NativeScheduledBeatNoteOffEvent

export type NativeScheduledSampleEvent =
  | NativeScheduledSampleNoteOnEvent
  | NativeScheduledSampleNoteOffEvent

export interface NativeScheduledBeatNoteOnEvent {
  readonly kind: 'note-on'
  readonly targetNode: number
  readonly note: number
  readonly velocity: number
  readonly atBeat: number
  readonly ownerLifetime?: ScheduledEventOwnerLifetime
  readonly traceId?: NativeNoteTraceId
}

export interface NativeScheduledBeatNoteOffEvent {
  readonly kind: 'note-off'
  readonly targetNode: number
  readonly note: number
  readonly atBeat: number
  readonly ownerLifetime?: ScheduledEventOwnerLifetime
  readonly traceId?: NativeNoteTraceId
}

export type ScheduledEventOwnerLifetime =
  | 'generation-bound'
  | 'completion-required'

export interface NativeNoteTraceId {
  readonly clipOwnerId: number
  readonly generation: number
  readonly noteId: number
  readonly role: 'note-on' | 'note-off'
}

export interface NativeScheduledSampleNoteOnEvent {
  readonly kind: 'note-on'
  readonly targetNode: number
  readonly note: number
  readonly velocity: number
  readonly atSample: number
}

export interface NativeScheduledSampleNoteOffEvent {
  readonly kind: 'note-off'
  readonly targetNode: number
  readonly note: number
  readonly atSample: number
}

export interface ScheduleSampleEventCommand extends DeviceCommandBase {
  readonly type: 'event:schedule-sample'
  readonly event: NativeScheduledSampleEvent
}

export interface ScheduleBeatEventCommand extends DeviceCommandBase {
  readonly type: 'event:schedule-beat'
  readonly event: NativeScheduledBeatEvent
  readonly atSample: number
  readonly clipId?: string
  readonly generation?: number
}

export interface ScheduleBeatEventBatchCommand extends DeviceCommandBase {
  readonly type: 'event:schedule-beat-batch'
  readonly clipId: string
  readonly generation: number
  readonly events: readonly NativeScheduledBeatEvent[]
  readonly atSample: number
}

export interface PreparedTransportStartCommand extends DeviceCommandBase {
  readonly type: 'transport:start-prepared'
  readonly atSample: number
  readonly tempo: {
    readonly originSample: number
    readonly originBeat: number
    readonly bpm: number
    readonly sampleRate: number
  }
  readonly transportLoop: {
    readonly enabled: boolean
    readonly startSample: number
    readonly endSample: number
  }
  readonly clipId: string
  readonly generation: number
  readonly events: readonly NativeScheduledBeatEvent[]
}

export interface LaunchClipCommand extends DeviceCommandBase {
  readonly type: 'clip:launch'
  readonly trackIndex: number
  readonly clipIndex: number
  readonly atBeat: number
}

export interface SwapExecutionPlanCommand extends DeviceCommandBase {
  readonly type: 'execution-plan:swap'
  readonly planId: number
}

export interface PanicCommand extends DeviceCommandBase {
  readonly type: 'panic'
}

export interface NativeAudioCommandAck {
  readonly commandId: string
  readonly type: EngineCommand['type']
  readonly accepted: boolean
}

export interface NativeEngineTelemetry {
  readonly samplePosition: number
  readonly sampleRate: number
  readonly blockSize: number
  readonly callbackLoad: number
  readonly xrunCount: number
  readonly commandQueueDepth: number
  readonly commandOverflowCount: number
  readonly telemetryOverflowCount: number
  readonly lateEventCount: number
}
