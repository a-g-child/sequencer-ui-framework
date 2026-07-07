import type { BeatTime } from '@sequencer/core'

export interface TempoMap {
  readonly defaultBpm: number
  readonly changes: readonly TempoChange[]
}

export interface TempoChange {
  readonly beat: BeatTime
  readonly bpm: number
}

export interface PlaybackModel {
  readonly id: string
  readonly createdAt: number
  readonly length: BeatTime
  readonly tempoMap: TempoMap
  readonly tracks: readonly PlaybackTrack[]
  readonly clips: readonly PlaybackClip[]
  readonly notes: readonly PlaybackNote[]
  readonly automations: readonly PlaybackAutomation[]
}

export interface PlaybackTrack {
  readonly id: string
  readonly name: string
  readonly channel: number
  readonly deviceInstanceId?: string
  readonly target?: string
}

export interface PlaybackClip {
  readonly id: string
  readonly trackId: string
  readonly patternId: string
  readonly name: string
  readonly start: BeatTime
  readonly length: BeatTime
  readonly loop: boolean
  readonly loopStart: BeatTime
  readonly loopLength: BeatTime
  readonly sourceStart: BeatTime
  readonly sourceLength: BeatTime
  readonly loopIndex: number
}

export interface PlaybackNote {
  readonly id: string
  readonly sourceNoteId: string
  readonly trackId: string
  readonly clipId: string
  readonly patternId: string
  readonly pitch: number
  readonly velocity: number
  readonly beat: BeatTime
  readonly duration: BeatTime
}

export interface PlaybackAutomation {
  readonly id: string
  readonly sourceEventId: string
  readonly trackId: string
  readonly clipId: string
  readonly patternId: string
  readonly parameterId: string
  readonly parameterKey?: string
  readonly deviceInstanceId?: string
  readonly value: number
  readonly beat: BeatTime
}

export function createEmptyPlaybackModel(bpm = 120): PlaybackModel {
  return freezePlaybackModel({
    id: 'playback-empty',
    createdAt: Date.now(),
    length: 0,
    tempoMap: {
      defaultBpm: bpm,
      changes: [{ beat: 0, bpm }]
    },
    tracks: [],
    clips: [],
    notes: [],
    automations: []
  })
}

export function freezePlaybackModel(model: PlaybackModel): PlaybackModel {
  model.tracks.forEach(Object.freeze)
  model.clips.forEach(Object.freeze)
  model.notes.forEach(Object.freeze)
  model.automations.forEach(Object.freeze)
  Object.freeze(model.tempoMap.changes)
  Object.freeze(model.tempoMap)
  Object.freeze(model.tracks)
  Object.freeze(model.clips)
  Object.freeze(model.notes)
  Object.freeze(model.automations)

  return Object.freeze(model)
}
