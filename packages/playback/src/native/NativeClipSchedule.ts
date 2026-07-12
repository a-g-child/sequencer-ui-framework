import type { PlaybackClip, PlaybackModel, PlaybackNote } from '../model.ts'
import type {
  NativeScheduledBeatEvent,
  ScheduleBeatEventBatchCommand,
  ScheduleBeatEventCommand,
  SetTempoMapCommand,
  SetTransportLoopCommand
} from './schemas.ts'

export const NATIVE_EVENT_INPUT_NODE_ID = 5

export interface ClipTimingSettings {
  readonly swing: number
  readonly grooveId?: string
  readonly grooveStrength?: number
}

export interface NativeClipSchedule {
  readonly clipId: string
  readonly generation: number
  readonly events: readonly NativeScheduledBeatEvent[]
}

export interface NativeClipScheduleOptions {
  readonly clipId: string
  readonly generation: number
  readonly targetNode?: number
  readonly timing?: ClipTimingSettings
}

export interface NativeClipScheduleCommandOptions {
  readonly timeMs: number
  readonly atSample?: number
}

export interface NativeTempoMapCommandOptions {
  readonly sampleRate: number
  readonly originSample?: number
  readonly originBeat?: number
  readonly atSample?: number
  readonly timeMs: number
}

export interface NativeTransportLoopCommandOptions {
  readonly clip: PlaybackClip
  readonly bpm: number
  readonly sampleRate: number
  readonly atSample?: number
  readonly timeMs: number
}

export class NativeClipScheduleSubmissionState {
  private readonly generations = new Map<string, number>()
  private active = false

  begin(clipId: string): number | undefined {
    if (this.active) return undefined

    return this.nextGeneration(clipId)
  }

  replace(clipId: string): number {
    return this.nextGeneration(clipId)
  }

  stop(): void {
    this.active = false
  }

  private nextGeneration(clipId: string): number {
    const generation = (this.generations.get(clipId) ?? 0) + 1

    this.generations.set(clipId, generation)
    this.active = true

    return generation
  }
}

export function applyClipTiming(
  sourceBeat: number,
  _timing: ClipTimingSettings
): number {
  return sourceBeat
}

export function compileNativeClipSchedule(
  model: PlaybackModel,
  options: NativeClipScheduleOptions
): NativeClipSchedule {
  const targetNode = options.targetNode ?? NATIVE_EVENT_INPUT_NODE_ID
  const timing = options.timing ?? { swing: 0 }
  const events = model.notes
    .filter((note) => note.clipId === options.clipId)
    .flatMap((note) => noteToNativeBeatEvents(note, targetNode, timing))
    .sort(compareNativeBeatEvents)

  return {
    clipId: options.clipId,
    generation: options.generation,
    events
  }
}

export function nativeClipScheduleCommands(
  schedule: NativeClipSchedule,
  options: NativeClipScheduleCommandOptions
): ScheduleBeatEventCommand[] {
  const atSample = options.atSample ?? 0

  return schedule.events.map((event, index) => ({
    id: `${schedule.clipId}:${schedule.generation}:schedule:${index}`,
    type: 'event:schedule-beat',
    clipId: schedule.clipId,
    generation: schedule.generation,
    event,
    atSample,
    timeMs: options.timeMs
  }))
}

export function nativeClipScheduleBatchCommand(
  schedule: NativeClipSchedule,
  options: NativeClipScheduleCommandOptions
): ScheduleBeatEventBatchCommand {
  return {
    id: `${schedule.clipId}:${schedule.generation}:schedule-batch`,
    type: 'event:schedule-beat-batch',
    clipId: schedule.clipId,
    generation: schedule.generation,
    events: schedule.events,
    atSample: options.atSample ?? 0,
    timeMs: options.timeMs
  }
}

export function createNativeTempoMapCommand(
  model: PlaybackModel,
  options: NativeTempoMapCommandOptions
): SetTempoMapCommand {
  const firstChange = model.tempoMap.changes[0]

  return {
    id: `${model.id}:tempo-map:set`,
    type: 'tempo-map:set',
    originSample: options.originSample ?? 0,
    originBeat: options.originBeat ?? firstChange?.beat ?? 0,
    bpm: firstChange?.bpm ?? model.tempoMap.defaultBpm,
    sampleRate: options.sampleRate,
    atSample: options.atSample ?? 0,
    timeMs: options.timeMs
  }
}

export function createNativeTransportLoopCommand(
  options: NativeTransportLoopCommandOptions
): SetTransportLoopCommand {
  const startBeat = options.clip.loop
    ? options.clip.start + options.clip.loopStart
    : options.clip.start
  const lengthBeat = options.clip.loop ? options.clip.loopLength : options.clip.length
  const startSample = beatToSample(startBeat, options.bpm, options.sampleRate)
  const endSample = beatToSample(
    startBeat + Math.max(0, lengthBeat),
    options.bpm,
    options.sampleRate
  )

  return {
    id: `${options.clip.id}:transport-loop:set`,
    type: 'transport-loop:set',
    enabled: options.clip.loop && endSample > startSample,
    startSample,
    endSample,
    atSample: options.atSample ?? 0,
    timeMs: options.timeMs
  }
}

function noteToNativeBeatEvents(
  note: PlaybackNote,
  targetNode: number,
  timing: ClipTimingSettings
): NativeScheduledBeatEvent[] {
  const pitch = clampMidiNote(note.pitch)
  const noteOnBeat = applyClipTiming(note.beat, timing)
  const noteOffBeat = applyClipTiming(note.beat + Math.max(0, note.duration), timing)

  return [
    {
      kind: 'note-on',
      targetNode,
      note: pitch,
      velocity: normalizeVelocity(note.velocity),
      atBeat: noteOnBeat
    },
    {
      kind: 'note-off',
      targetNode,
      note: pitch,
      atBeat: noteOffBeat
    }
  ]
}

function compareNativeBeatEvents(
  left: NativeScheduledBeatEvent,
  right: NativeScheduledBeatEvent
): number {
  return (
    left.atBeat - right.atBeat ||
    eventKindSortValue(left) - eventKindSortValue(right) ||
    left.note - right.note
  )
}

function eventKindSortValue(event: NativeScheduledBeatEvent): number {
  return event.kind === 'note-off' ? 0 : 1
}

function clampMidiNote(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)))
}

function normalizeVelocity(value: number): number {
  const normalized = value > 1 ? value / 127 : value

  return Math.max(0, Math.min(1, normalized))
}

function beatToSample(beat: number, bpm: number, sampleRate: number): number {
  return Math.max(0, Math.round((beat * 60 * sampleRate) / Math.max(1, bpm)))
}
