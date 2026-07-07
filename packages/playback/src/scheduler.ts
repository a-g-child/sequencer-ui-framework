import type { BeatTime } from '@sequencer/core'
import type { ClockState } from './clock'
import type { PlaybackEvent } from './events'
import type { PlaybackModel } from './model'
import { createEmptyPlaybackModel } from './model'
import { beatsToMs, msToBeats } from './tempo'

export interface Scheduler {
  setModel(model: PlaybackModel): void
  start(position: BeatTime): void
  stop(): void
  seek(position: BeatTime): void
  tick(state: ClockState): readonly PlaybackEvent[]
  scheduleLookahead(window: number): readonly PlaybackEvent[]
}

export interface SchedulerStatus {
  readonly running: boolean
  readonly queuedEventCount: number
  readonly currentBeat: BeatTime
  readonly lastEmittedEvent?: PlaybackEvent
  readonly lookaheadDepthBeats: BeatTime
  readonly maxLookaheadDepthBeats: BeatTime
  readonly lookaheadDepthMs: number
  readonly maxLookaheadDepthMs: number
  readonly largestEventBatch: number
}

export interface TypeScriptSchedulerOptions {
  readonly lookaheadMs?: number
  readonly automationSampleIntervalBeats?: BeatTime
}

export type PlaybackRuntimeParameterValue = {
  readonly parameterId: string
  readonly parameterKey?: string
  readonly value: number
  readonly trackId: string
}

export class TypeScriptScheduler implements Scheduler {
  private model: PlaybackModel = createEmptyPlaybackModel()
  private running = false
  private currentBeat = 0
  private currentTimeMs = 0
  private scheduledUntilBeat = 0
  private readonly emittedEventIds = new Set<string>()
  private queuedEventCount = 0
  private lastEmittedEvent?: PlaybackEvent
  private lookaheadDepthBeats = 0
  private maxLookaheadDepthBeats = 0
  private lookaheadDepthMs = 0
  private maxLookaheadDepthMs = 0
  private largestEventBatch = 0

  constructor(private readonly options: TypeScriptSchedulerOptions = {}) {}

  get status(): SchedulerStatus {
    return {
      running: this.running,
      queuedEventCount: this.queuedEventCount,
      currentBeat: this.currentBeat,
      lastEmittedEvent: this.lastEmittedEvent,
      lookaheadDepthBeats: this.lookaheadDepthBeats,
      maxLookaheadDepthBeats: this.maxLookaheadDepthBeats,
      lookaheadDepthMs: this.lookaheadDepthMs,
      maxLookaheadDepthMs: this.maxLookaheadDepthMs,
      largestEventBatch: this.largestEventBatch
    }
  }

  setModel(model: PlaybackModel): void {
    this.model = model
    this.seek(this.currentBeat)
  }

  start(position: BeatTime): void {
    this.running = true
    this.currentBeat = Math.max(0, position)
    this.scheduledUntilBeat = this.currentBeat
    this.emittedEventIds.clear()
  }

  stop(): void {
    this.running = false
    this.currentBeat = 0
    this.scheduledUntilBeat = 0
    this.currentTimeMs = 0
    this.queuedEventCount = 0
    this.lookaheadDepthBeats = 0
    this.lookaheadDepthMs = 0
    this.emittedEventIds.clear()
  }

  seek(position: BeatTime): void {
    const beat = Math.max(0, position)
    this.currentBeat = beat
    this.scheduledUntilBeat = beat
    this.queuedEventCount = 0
    this.emittedEventIds.clear()
  }

  tick(state: ClockState): readonly PlaybackEvent[] {
    if (!this.running) return []

    this.currentBeat = state.beat
    this.currentTimeMs = state.timeMs
    return this.scheduleLookahead(this.options.lookaheadMs ?? 120)
  }

  scheduleLookahead(window: number): readonly PlaybackEvent[] {
    if (!this.running) return []

    const windowBeats = window > 64 ? msToBeats(window, this.model.tempoMap) : window
    const fromBeat = this.scheduledUntilBeat
    const toBeat = Math.max(fromBeat, this.currentBeat + windowBeats)
    this.lookaheadDepthBeats = Math.max(0, toBeat - this.currentBeat)
    this.maxLookaheadDepthBeats = Math.max(
      this.maxLookaheadDepthBeats,
      this.lookaheadDepthBeats
    )
    this.lookaheadDepthMs = beatsToMs(this.lookaheadDepthBeats, this.model.tempoMap)
    this.maxLookaheadDepthMs = Math.max(
      this.maxLookaheadDepthMs,
      this.lookaheadDepthMs
    )
    const events = this.buildEvents(fromBeat, toBeat)

    const emittedEvents: PlaybackEvent[] = []

    for (const event of events) {
      if (this.emittedEventIds.has(event.id)) continue

      this.emittedEventIds.add(event.id)
      this.lastEmittedEvent = event
      emittedEvents.push(event)
    }

    this.scheduledUntilBeat = toBeat
    this.queuedEventCount = emittedEvents.length
    this.largestEventBatch = Math.max(this.largestEventBatch, emittedEvents.length)

    return emittedEvents
  }

  private buildEvents(fromBeat: BeatTime, toBeat: BeatTime): PlaybackEvent[] {
    const tracksById = new Map(this.model.tracks.map((track) => [track.id, track]))
    const clipsById = new Map(this.model.clips.map((clip) => [clip.id, clip]))
    const events: PlaybackEvent[] = []

    for (const note of this.model.notes) {
      const clip = clipsById.get(note.clipId)

      if (!clip?.loop) {
        this.addNoteEvents(events, tracksById, note, note.beat, fromBeat, toBeat)
        continue
      }

      const loopStartBeat = clip.start + clip.loopStart
      const loopEndBeat = loopStartBeat + clip.loopLength

      if (note.beat < loopStartBeat) {
        this.addNoteEvents(events, tracksById, note, note.beat, fromBeat, toBeat)
        continue
      }

      if (note.beat >= loopEndBeat) continue

      const firstRepeat = Math.max(
        0,
        Math.floor((fromBeat - note.beat - note.duration) / clip.loopLength)
      )
      const lastRepeat = Math.ceil((toBeat - note.beat) / clip.loopLength)

      for (let repeatIndex = firstRepeat; repeatIndex <= lastRepeat; repeatIndex += 1) {
        this.addNoteEvents(
          events,
          tracksById,
          note,
          note.beat + repeatIndex * clip.loopLength,
          fromBeat,
          toBeat,
          repeatIndex
        )
      }
    }

    for (const lane of buildAutomationLanes(this.model)) {
      this.addAutomationSampleEvents(events, tracksById, lane, fromBeat, toBeat)
    }

    return events.sort((a, b) => a.beat - b.beat || sortEventType(a) - sortEventType(b))
  }

  private addNoteEvents(
    events: PlaybackEvent[],
    tracksById: Map<
      string,
      { readonly channel: number; readonly deviceInstanceId?: string }
    >,
    note: { readonly id: string; readonly trackId: string; readonly pitch: number; readonly velocity: number; readonly duration: number },
    beat: BeatTime,
    fromBeat: BeatTime,
    toBeat: BeatTime,
    repeatIndex = 0
  ): void {
    const noteOffBeat = beat + note.duration
    const track = tracksById.get(note.trackId)
    const destination = destinationForTrack(note.trackId, track?.deviceInstanceId)
    const repeatSuffix = repeatIndex > 0 ? `:repeat-${repeatIndex}` : ''
    const noteId = `${note.id}${repeatSuffix}`

    if (beat >= fromBeat && beat < toBeat) {
      events.push({
        id: `${note.id}${repeatSuffix}:on`,
        type: 'note:on',
        noteId,
        trackId: note.trackId,
        channel: track?.channel,
        destination,
        pitch: note.pitch,
        velocity: note.velocity,
        beat,
        timeMs: this.eventTimeMs(beat)
      })
    }

    if (noteOffBeat >= fromBeat && noteOffBeat < toBeat) {
      events.push({
        id: `${note.id}${repeatSuffix}:off`,
        type: 'note:off',
        noteId,
        trackId: note.trackId,
        channel: track?.channel,
        destination,
        pitch: note.pitch,
        velocity: 0,
        beat: noteOffBeat,
        timeMs: this.eventTimeMs(noteOffBeat)
      })
    }
  }

  private addAutomationEvent(
    events: PlaybackEvent[],
    tracksById: Map<
      string,
      { readonly channel: number; readonly deviceInstanceId?: string }
    >,
    automation: {
      readonly id: string
      readonly trackId: string
      readonly parameterId: string
      readonly parameterKey?: string
      readonly deviceInstanceId?: string
      readonly value: number
    },
    beat: BeatTime,
    fromBeat: BeatTime,
    toBeat: BeatTime,
    repeatIndex = 0
  ): void {
    if (beat < fromBeat || beat >= toBeat) return

    const track = tracksById.get(automation.trackId)
    const destination = destinationForTrack(
      automation.trackId,
      automation.deviceInstanceId ?? track?.deviceInstanceId
    )
    const repeatSuffix = repeatIndex > 0 ? `:repeat-${repeatIndex}` : ''

    events.push({
      id: `${automation.id}${repeatSuffix}:automation`,
      type: 'automation:set',
      automationId: automation.id,
      trackId: automation.trackId,
      channel: track?.channel,
      destination,
      parameterId: automation.parameterId,
      parameterKey: automation.parameterKey,
      value: automation.value,
      beat,
      timeMs: this.eventTimeMs(beat)
    })
  }

  private addAutomationSampleEvents(
    events: PlaybackEvent[],
    tracksById: Map<
      string,
      { readonly channel: number; readonly deviceInstanceId?: string }
    >,
    lane: AutomationLane,
    fromBeat: BeatTime,
    toBeat: BeatTime
  ): void {
    const interval = this.options.automationSampleIntervalBeats ?? 1 / 64
    const sampleInterval = Number.isFinite(interval) && interval > 0
      ? interval
      : 1 / 64
    let beat = fromBeat

    while (beat < toBeat) {
      const value = sampleAutomationLane(lane, beat)

      if (value !== undefined) {
        this.addAutomationEvent(
          events,
          tracksById,
          {
            id: lane.id,
            trackId: lane.trackId,
            parameterId: lane.parameterId,
            parameterKey: lane.parameterKey,
            deviceInstanceId: lane.deviceInstanceId,
            value
          },
          beat,
          fromBeat,
          toBeat,
          sampleIndexForBeat(beat)
        )
      }

      beat += sampleInterval
    }
  }

  private eventTimeMs(beat: BeatTime): number {
    const deltaBeats = beat - this.currentBeat

    return this.currentTimeMs + beatsToMs(deltaBeats, this.model.tempoMap)
  }
}

type AutomationLane = {
  readonly id: string
  readonly trackId: string
  readonly clipId: string
  readonly parameterId: string
  readonly parameterKey?: string
  readonly deviceInstanceId?: string
  readonly clip: PlaybackModel['clips'][number]
  readonly points: readonly {
    readonly beat: BeatTime
    readonly value: number
  }[]
}

type MutableAutomationLane = Omit<AutomationLane, 'points'> & {
  points: {
    beat: BeatTime
    value: number
  }[]
}

export function samplePlaybackAutomationValues(
  model: PlaybackModel,
  beat: BeatTime
): readonly PlaybackRuntimeParameterValue[] {
  return buildAutomationLanes(model).flatMap((lane) => {
    const value = sampleAutomationLane(lane, beat)

    if (value === undefined) return []

    return [{
      parameterId: lane.parameterId,
      parameterKey: lane.parameterKey,
      trackId: lane.trackId,
      value
    }]
  })
}

function buildAutomationLanes(model: PlaybackModel): AutomationLane[] {
  const clipsById = new Map(model.clips.map((clip) => [clip.id, clip]))
  const lanes = new Map<string, MutableAutomationLane>()

  for (const automation of model.automations) {
    const clip = clipsById.get(automation.clipId)

    if (!clip) continue

    const laneId = [
      automation.clipId,
      automation.trackId,
      automation.parameterId
    ].join(':')
    const lane = lanes.get(laneId)

    if (lane) {
      lane.points.push({ beat: automation.beat, value: automation.value })
      continue
    }

    lanes.set(laneId, {
      id: laneId,
      trackId: automation.trackId,
      clipId: automation.clipId,
      parameterId: automation.parameterId,
      parameterKey: automation.parameterKey,
      deviceInstanceId: automation.deviceInstanceId,
      clip,
      points: [{ beat: automation.beat, value: automation.value }]
    })
  }

  return [...lanes.values()].map((lane) => ({
    ...lane,
    points: [...lane.points].sort((left, right) => left.beat - right.beat)
  }))
}

function sampleAutomationLane(
  lane: AutomationLane,
  beat: BeatTime
): number | undefined {
  const sourceBeat = resolveAutomationSourceBeat(lane.clip, beat)

  if (sourceBeat === undefined) return undefined

  return interpolateAutomationPoints(lane.points, sourceBeat)
}

function resolveAutomationSourceBeat(
  clip: PlaybackModel['clips'][number],
  beat: BeatTime
): BeatTime | undefined {
  if (beat < clip.start) return undefined

  if (!clip.loop) {
    return beat <= clip.start + clip.length ? beat : undefined
  }

  const loopStartBeat = clip.start + clip.loopStart

  if (beat < loopStartBeat) {
    return beat <= clip.start + clip.length ? beat : undefined
  }

  if (clip.loopLength <= 0) return undefined

  return loopStartBeat + ((beat - loopStartBeat) % clip.loopLength)
}

function interpolateAutomationPoints(
  points: readonly { readonly beat: BeatTime; readonly value: number }[],
  beat: BeatTime
): number | undefined {
  if (points.length === 0) return undefined

  const first = points[0]
  const last = points[points.length - 1]

  if (beat <= first.beat) return first.value
  if (beat >= last.beat) return last.value

  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]
    const right = points[index + 1]

    if (beat < left.beat || beat > right.beat) continue

    const range = right.beat - left.beat
    const t = range === 0 ? 1 : (beat - left.beat) / range

    return left.value + (right.value - left.value) * t
  }

  return last.value
}

function sampleIndexForBeat(beat: BeatTime): number {
  return Math.round(beat * 1_000_000)
}

function destinationForTrack(
  trackId: string | undefined,
  deviceInstanceId: string | undefined
): PlaybackEvent['destination'] {
  if (!trackId && !deviceInstanceId) return undefined

  return {
    trackId,
    deviceInstanceId
  }
}

function sortEventType(event: PlaybackEvent): number {
  if (event.type === 'note:off') return 0
  if (event.type === 'automation:set') return 1
  if (event.type === 'note:on') return 2

  return 3
}
