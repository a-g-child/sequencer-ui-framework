import type { PlaybackClip, PlaybackModel, PlaybackNote } from '../model.ts'
import type {
  NativeScheduledBeatEvent,
  ScheduleSampleEventCommand,
  ScheduleBeatEventBatchCommand,
  ScheduleBeatEventCommand,
  SetScheduledEventOwnerGenerationCommand,
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

export interface NativeClipScheduleGeneration {
  readonly clipId: string
  readonly generation: number
}

export interface NativeClipScheduleSubmission {
  readonly active?: NativeClipScheduleGeneration
  readonly invalidations: readonly NativeClipScheduleGeneration[]
}

export interface NativeTempoMapCommandOptions {
  readonly sampleRate: number
  readonly bpm?: number
  readonly originSample?: number
  readonly originBeat?: number
  readonly atSample?: number
  readonly timeMs: number
}

export interface NativeTransportLoopCommandOptions {
  readonly clip: PlaybackClip
  readonly bpm: number
  readonly sampleRate: number
  readonly originSample?: number
  readonly originBeat?: number
  readonly atSample?: number
  readonly timeMs: number
}

export class NativeClipScheduleSubmissionState {
  private readonly generations = new Map<string, number>()
  private activeClipId: string | undefined
  private active = false

  begin(clipId: string): NativeClipScheduleSubmission | undefined {
    if (this.active) return undefined

    return {
      active: this.activate(clipId),
      invalidations: []
    }
  }

  replace(clipId: string): NativeClipScheduleSubmission {
    const invalidations =
      this.activeClipId && this.activeClipId !== clipId
        ? [this.nextGeneration(this.activeClipId)]
        : []

    return {
      active: this.activate(clipId),
      invalidations
    }
  }

  clear(): NativeClipScheduleSubmission | undefined {
    if (!this.activeClipId) {
      this.active = false
      return undefined
    }

    const invalidation = this.nextGeneration(this.activeClipId)

    this.activeClipId = undefined
    this.active = false

    return {
      invalidations: [invalidation]
    }
  }

  stop(): void {
    this.active = false
    this.activeClipId = undefined
  }

  private activate(clipId: string): NativeClipScheduleGeneration {
    const generation = this.nextGeneration(clipId)

    this.activeClipId = clipId
    this.active = true

    return generation
  }

  private nextGeneration(clipId: string): NativeClipScheduleGeneration {
    const generation = (this.generations.get(clipId) ?? 0) + 1

    this.generations.set(clipId, generation)

    return { clipId, generation }
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

export function nativeScheduledEventOwnerGenerationCommand(
  generation: NativeClipScheduleGeneration,
  options: NativeClipScheduleCommandOptions
): SetScheduledEventOwnerGenerationCommand {
  return {
    id: `${generation.clipId}:${generation.generation}:owner-generation`,
    type: 'event-owner:generation:set',
    clipId: generation.clipId,
    generation: generation.generation,
    atSample: options.atSample ?? 0,
    timeMs: options.timeMs
  }
}

export function nativeClipImmediateNoteOffCommands(
  model: PlaybackModel,
  options: {
    readonly clipId: string
    readonly beat: number
    readonly atSample: number
    readonly timeMs: number
    readonly targetNode?: number
  }
): ScheduleSampleEventCommand[] {
  const clip = model.clips.find((candidate) => candidate.id === options.clipId)

  if (!clip) return []

  const targetNode = options.targetNode ?? NATIVE_EVENT_INPUT_NODE_ID
  const activeNotes = model.notes.filter(
    (note) =>
      note.clipId === options.clipId &&
      noteIsActiveAtBeat(note, clip, options.beat)
  )
  const notes = [...new Set(activeNotes.map((note) => clampMidiNote(note.pitch)))]

  return notes.map((note, index) => ({
    id: `${options.clipId}:clip-stop:${index}`,
    type: 'event:schedule-sample',
    event: {
      kind: 'note-off',
      targetNode,
      note,
      atSample: options.atSample
    },
    timeMs: options.timeMs
  }))
}

export function createNativeTempoMapCommand(
  model: PlaybackModel,
  options: NativeTempoMapCommandOptions
): SetTempoMapCommand {
  const firstChange = model.tempoMap.changes[0]
  const bpm = options.bpm ?? firstChange?.bpm ?? model.tempoMap.defaultBpm

  return {
    id: `${model.id}:tempo-map:set`,
    type: 'tempo-map:set',
    originSample: options.originSample ?? 0,
    originBeat: options.originBeat ?? firstChange?.beat ?? 0,
    bpm,
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
  const startSample = beatToSample(
    startBeat,
    options.bpm,
    options.sampleRate,
    options.originSample,
    options.originBeat
  )
  const endSample = beatToSample(
    startBeat + Math.max(0, lengthBeat),
    options.bpm,
    options.sampleRate,
    options.originSample,
    options.originBeat
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

function noteIsActiveAtBeat(
  note: PlaybackNote,
  clip: PlaybackClip,
  beat: number
): boolean {
  const duration = Math.max(0, note.duration)

  if (duration <= 0) return false

  const noteOnBeat = note.beat
  const noteOffBeat = note.beat + duration

  if (!clip.loop || clip.loopLength <= 0) {
    return beat >= noteOnBeat && beat < noteOffBeat
  }

  const loopStartBeat = clip.start + clip.loopStart
  const loopEndBeat = loopStartBeat + clip.loopLength
  const loopBeat = loopStartBeat + positiveModulo(beat - loopStartBeat, clip.loopLength)
  const noteOnInLoop = loopStartBeat + positiveModulo(noteOnBeat - loopStartBeat, clip.loopLength)
  const noteOffInLoop = loopStartBeat + positiveModulo(noteOffBeat - loopStartBeat, clip.loopLength)

  if (duration >= clip.loopLength) return true

  if (noteOffBeat <= loopEndBeat && noteOnInLoop < noteOffInLoop) {
    return loopBeat >= noteOnInLoop && loopBeat < noteOffInLoop
  }

  return loopBeat >= noteOnInLoop || loopBeat < noteOffInLoop
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

function beatToSample(
  beat: number,
  bpm: number,
  sampleRate: number,
  originSample = 0,
  originBeat = 0
): number {
  return Math.max(
    0,
    Math.round(originSample + ((beat - originBeat) * 60 * sampleRate) / Math.max(1, bpm))
  )
}
