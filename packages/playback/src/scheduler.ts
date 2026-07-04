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
}

export interface TypeScriptSchedulerOptions {
  readonly lookaheadMs?: number
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

  constructor(private readonly options: TypeScriptSchedulerOptions = {}) {}

  get status(): SchedulerStatus {
    return {
      running: this.running,
      queuedEventCount: this.queuedEventCount,
      currentBeat: this.currentBeat,
      lastEmittedEvent: this.lastEmittedEvent
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

    return events.sort((a, b) => a.beat - b.beat || sortEventType(a) - sortEventType(b))
  }

  private addNoteEvents(
    events: PlaybackEvent[],
    tracksById: Map<string, { readonly channel: number }>,
    note: { readonly id: string; readonly trackId: string; readonly pitch: number; readonly velocity: number; readonly duration: number },
    beat: BeatTime,
    fromBeat: BeatTime,
    toBeat: BeatTime,
    repeatIndex = 0
  ): void {
    const noteOffBeat = beat + note.duration
    const track = tracksById.get(note.trackId)
    const repeatSuffix = repeatIndex > 0 ? `:repeat-${repeatIndex}` : ''

    if (beat >= fromBeat && beat < toBeat) {
      events.push({
        id: `${note.id}${repeatSuffix}:on`,
        type: 'note:on',
        noteId: note.id,
        trackId: note.trackId,
        channel: track?.channel,
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
        noteId: note.id,
        trackId: note.trackId,
        channel: track?.channel,
        pitch: note.pitch,
        velocity: 0,
        beat: noteOffBeat,
        timeMs: this.eventTimeMs(noteOffBeat)
      })
    }
  }

  private eventTimeMs(beat: BeatTime): number {
    const deltaBeats = beat - this.currentBeat

    return this.currentTimeMs + beatsToMs(deltaBeats, this.model.tempoMap)
  }
}

function sortEventType(event: PlaybackEvent): number {
  if (event.type === 'note:off') return 0
  if (event.type === 'note:on') return 1

  return 2
}
