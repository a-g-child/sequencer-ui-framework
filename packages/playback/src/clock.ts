import type { BeatTime } from '@sequencer/core'

export interface ClockState {
  readonly running: boolean
  readonly beat: BeatTime
  readonly bpm: number
  readonly timeMs: number
  readonly sourceId: string
  readonly driftMs?: number
  readonly tickId?: number
}

export type ClockEvent =
  | ClockStartedEvent
  | ClockStoppedEvent
  | ClockTickEvent
  | ClockSeekedEvent
  | ClockTempoChangedEvent
  | ClockDriftEvent

export interface ClockEventBase {
  readonly type: ClockEvent['type']
  readonly state: ClockState
}

export interface ClockStartedEvent extends ClockEventBase {
  readonly type: 'clock:started'
}

export interface ClockStoppedEvent extends ClockEventBase {
  readonly type: 'clock:stopped'
}

export interface ClockTickEvent extends ClockEventBase {
  readonly type: 'clock:tick'
}

export interface ClockSeekedEvent extends ClockEventBase {
  readonly type: 'clock:seeked'
}

export interface ClockTempoChangedEvent extends ClockEventBase {
  readonly type: 'clock:tempo-changed'
}

export interface ClockDriftEvent extends ClockEventBase {
  readonly type: 'clock:drift'
}

export type ClockEventListener = (event: ClockEvent) => void

export interface ClockSource {
  readonly id: string
  readonly name: string
  start(): void
  stop(): void
  pause(): void
  resume(): void
  seek(beat: BeatTime): void
  setBpm(bpm: number): void
  getState(): ClockState
  subscribe(listener: ClockEventListener): () => void
}

export class ClockSourceRegistry {
  private readonly sources = new Map<string, ClockSource>()

  add<T extends ClockSource>(source: T): T {
    if (this.sources.has(source.id)) {
      throw new Error(`Clock source already registered: ${source.id}`)
    }

    this.sources.set(source.id, source)
    return source
  }

  get(id: string): ClockSource {
    const source = this.sources.get(id)

    if (!source) {
      throw new Error(`Clock source not found: ${id}`)
    }

    return source
  }

  values(): ClockSource[] {
    return [...this.sources.values()]
  }
}

export interface InternalClockSourceOptions {
  readonly bpm?: number
  readonly intervalMs?: number
}

export class InternalClockSource implements ClockSource {
  readonly id = 'internal'
  readonly name = 'Internal Clock'

  private running = false
  private beat = 0
  private bpm: number
  private startBeat = 0
  private startTimeMs = 0
  private lastTimeMs = 0
  private tickId = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly listeners = new Set<ClockEventListener>()
  private readonly intervalMs: number

  constructor(options: InternalClockSourceOptions = {}) {
    this.bpm = options.bpm ?? 120
    this.intervalMs = options.intervalMs ?? 25
    this.lastTimeMs = nowMs()
  }

  start(): void {
    this.running = true
    this.startBeat = this.beat
    this.startTimeMs = nowMs()
    this.lastTimeMs = this.startTimeMs
    this.ensureTimer()
    this.emit('clock:started')
  }

  stop(): void {
    this.running = false
    this.beat = 0
    this.startBeat = 0
    this.clearTimer()
    this.lastTimeMs = nowMs()
    this.emit('clock:stopped')
  }

  pause(): void {
    if (!this.running) return

    this.updateBeat(nowMs())
    this.running = false
    this.clearTimer()
    this.emit('clock:stopped')
  }

  resume(): void {
    if (this.running) return

    this.start()
  }

  seek(beat: BeatTime): void {
    this.beat = Math.max(0, beat)
    this.startBeat = this.beat
    this.startTimeMs = nowMs()
    this.lastTimeMs = this.startTimeMs
    this.emit('clock:seeked')
  }

  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm === this.bpm) return

    this.updateBeat(nowMs())
    this.bpm = bpm
    this.startBeat = this.beat
    this.startTimeMs = nowMs()
    this.emit('clock:tempo-changed')
  }

  getState(): ClockState {
    return {
      running: this.running,
      beat: this.beat,
      bpm: this.bpm,
      timeMs: this.lastTimeMs,
      sourceId: this.id,
      tickId: this.tickId
    }
  }

  subscribe(listener: ClockEventListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  private ensureTimer(): void {
    if (this.timer) return

    this.timer = setInterval(() => {
      if (!this.running) return

      this.updateBeat(nowMs())
      this.tickId += 1
      this.emit('clock:tick')
    }, this.intervalMs)
  }

  private clearTimer(): void {
    if (!this.timer) return

    clearInterval(this.timer)
    this.timer = undefined
  }

  private updateBeat(timeMs: number): void {
    this.lastTimeMs = timeMs
    this.beat = this.startBeat + ((timeMs - this.startTimeMs) * this.bpm) / 60_000
  }

  private emit(type: ClockEvent['type']): void {
    const state = this.getState()

    for (const listener of this.listeners) {
      listener({ type, state } as ClockEvent)
    }
  }
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
