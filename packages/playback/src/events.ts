import type { BeatTime } from '@sequencer/core'

export type PlaybackEvent =
  | NoteOnEvent
  | NoteOffEvent
  | AutomationEvent
  | TempoChangeEvent
  | TransportEvent

export interface PlaybackEventBase {
  readonly id: string
  readonly trackId?: string
  readonly channel?: number
  readonly beat: BeatTime
  readonly timeMs: number
}

export interface NoteOnEvent extends PlaybackEventBase {
  readonly type: 'note:on'
  readonly noteId: string
  readonly pitch: number
  readonly velocity: number
}

export interface NoteOffEvent extends PlaybackEventBase {
  readonly type: 'note:off'
  readonly noteId: string
  readonly pitch: number
  readonly velocity: 0
}

export interface AutomationEvent extends PlaybackEventBase {
  readonly type: 'automation:set'
  readonly automationId: string
  readonly parameterId: string
  readonly parameterKey?: string
  readonly value: number
}

export interface TempoChangeEvent extends PlaybackEventBase {
  readonly type: 'tempo:change'
  readonly bpm: number
}

export interface TransportEvent extends PlaybackEventBase {
  readonly type: 'transport'
  readonly action: 'start' | 'stop' | 'seek'
}
