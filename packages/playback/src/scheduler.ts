import type { BeatTime } from '@sequencer/core'
import type { PlaybackEvent } from './events'
import type { PlaybackModel } from './model'
import { createEmptyPlaybackModel } from './model'
import type { PlaybackOutput } from './output'
import { beatsToMs, msToBeats } from './tempo'

export interface Scheduler {
  setModel(model: PlaybackModel): void
  start(position: BeatTime): void
  stop(): void
  seek(position: BeatTime): void
  tick(now: number): void
  scheduleLookahead(window: number): readonly PlaybackEvent[]
}

export interface SchedulerStatus {
  readonly running: boolean
  readonly queuedEventCount: number
  readonly currentBeat: BeatTime
  readonly lastEmittedEvent?: PlaybackEvent
}

export interface TypeScriptSchedulerOptions {
  readonly output?: PlaybackOutput
  readonly lookaheadMs?: number
}

export class TypeScriptScheduler implements Scheduler {
  private model: PlaybackModel = createEmptyPlaybackModel()
  private running = false
  private startTimeMs = 0
  private startBeat = 0
  private currentBeat = 0
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
    this.startBeat = Math.max(0, position)
    this.currentBeat = this.startBeat
    this.scheduledUntilBeat = this.startBeat
    this.startTimeMs = nowMs()
    this.emittedEventIds.clear()
  }

  stop(): void {
    this.running = false
    this.currentBeat = 0
    this.startBeat = 0
    this.scheduledUntilBeat = 0
    this.queuedEventCount = 0
    this.emittedEventIds.clear()
  }

  seek(position: BeatTime): void {
    const beat = Math.max(0, position)
    this.currentBeat = beat
    this.startBeat = beat
    this.scheduledUntilBeat = beat
    this.startTimeMs = nowMs()
    this.queuedEventCount = 0
    this.emittedEventIds.clear()
  }

  tick(now: number): void {
    if (!this.running) return

    const elapsedMs = Math.max(0, now - this.startTimeMs)
    this.currentBeat = this.startBeat + msToBeats(elapsedMs, this.model.tempoMap)
    this.scheduleLookahead(this.options.lookaheadMs ?? 120)
  }

  scheduleLookahead(window: number): readonly PlaybackEvent[] {
    if (!this.running) return []

    const windowBeats = window > 64 ? msToBeats(window, this.model.tempoMap) : window
    const fromBeat = this.scheduledUntilBeat
    const toBeat = Math.max(fromBeat, this.currentBeat + windowBeats)
    const events = this.buildEvents(fromBeat, toBeat)

    for (const event of events) {
      if (this.emittedEventIds.has(event.id)) continue

      this.emittedEventIds.add(event.id)
      this.lastEmittedEvent = event
      this.options.output?.handleEvent(event)
    }

    this.scheduledUntilBeat = toBeat
    this.queuedEventCount = events.length

    return events
  }

  private buildEvents(fromBeat: BeatTime, toBeat: BeatTime): PlaybackEvent[] {
    const tracksById = new Map(this.model.tracks.map((track) => [track.id, track]))
    const events: PlaybackEvent[] = []

    for (const note of this.model.notes) {
      const noteOffBeat = note.beat + note.duration

      if (note.beat >= fromBeat && note.beat < toBeat) {
        const track = tracksById.get(note.trackId)
        events.push({
          id: `${note.id}:on`,
          type: 'note:on',
          noteId: note.id,
          trackId: note.trackId,
          channel: track?.channel,
          pitch: note.pitch,
          velocity: note.velocity,
          beat: note.beat,
          timeMs: this.eventTimeMs(note.beat)
        })
      }

      if (noteOffBeat >= fromBeat && noteOffBeat < toBeat) {
        const track = tracksById.get(note.trackId)
        events.push({
          id: `${note.id}:off`,
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

    return events.sort((a, b) => a.beat - b.beat || sortEventType(a) - sortEventType(b))
  }

  private eventTimeMs(beat: BeatTime): number {
    const deltaBeats = beat - this.startBeat

    return this.startTimeMs + beatsToMs(deltaBeats, this.model.tempoMap)
  }
}

function sortEventType(event: PlaybackEvent): number {
  if (event.type === 'note:off') return 0
  if (event.type === 'note:on') return 1

  return 2
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
