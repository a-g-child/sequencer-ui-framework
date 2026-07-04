import type { BeatTime, Service, ServiceContext, ServiceEvent } from '@sequencer/core'
import {
  ClockSourceRegistry,
  InternalClockSource,
  type ClockEvent,
  type ClockSource,
  type ClockState
} from './clock'

export interface ClockServiceStatus {
  readonly activeSourceId: string
  readonly activeSourceName: string
  readonly availableSourceIds: readonly string[]
  readonly state: ClockState
}

export class ClockService implements Service {
  readonly id = 'clock'
  readonly name = 'Clock'

  readonly sources = new ClockSourceRegistry()

  private context?: ServiceContext
  private activeSource: ClockSource
  private unsubscribeClock?: () => void
  private unsubscribeServiceEvents?: () => void

  constructor(source: ClockSource = new InternalClockSource()) {
    this.activeSource = this.sources.add(source)
  }

  initialise(context: ServiceContext): void {
    this.context = context
    this.unsubscribeClock = this.activeSource.subscribe((event) =>
      this.handleClockEvent(event)
    )
    this.unsubscribeServiceEvents = context.events.subscribe((event) =>
      this.handleServiceEvent(event)
    )
    this.emitStatus()
  }

  shutdown(): void {
    this.stop()
    this.unsubscribeClock?.()
    this.unsubscribeServiceEvents?.()
    this.context = undefined
  }

  get status(): ClockServiceStatus {
    return {
      activeSourceId: this.activeSource.id,
      activeSourceName: this.activeSource.name,
      availableSourceIds: this.sources.values().map((source) => source.id),
      state: this.activeSource.getState()
    }
  }

  start(): void {
    this.activeSource.start()
  }

  stop(): void {
    this.activeSource.stop()
  }

  pause(): void {
    this.activeSource.pause()
  }

  resume(): void {
    this.activeSource.resume()
  }

  seek(beat: BeatTime): void {
    this.activeSource.seek(beat)
  }

  setBpm(bpm: number): void {
    this.activeSource.setBpm(bpm)
  }

  useSource(sourceId: string): void {
    if (sourceId === this.activeSource.id) return

    const previousState = this.activeSource.getState()
    this.unsubscribeClock?.()
    this.activeSource.stop()
    this.activeSource = this.sources.get(sourceId)
    this.activeSource.seek(previousState.beat)
    this.activeSource.setBpm(previousState.bpm)
    this.unsubscribeClock = this.activeSource.subscribe((event) =>
      this.handleClockEvent(event)
    )

    if (previousState.running) {
      this.activeSource.start()
    }

    this.emitStatus()
  }

  private handleServiceEvent(event: ServiceEvent): void {
    if (event.serviceId === this.id) return

    if (event.type === 'transport:playing-changed') {
      const payload = event.payload as { playing?: boolean } | undefined

      if (payload?.playing) {
        this.start()
      } else {
        this.stop()
      }
    }

    if (event.type === 'transport:tempo-changed') {
      const payload = event.payload as { bpm?: number } | undefined

      if (typeof payload?.bpm === 'number') {
        this.setBpm(payload.bpm)
      }
    }

    if (event.type === 'transport:seeked') {
      const payload = event.payload as { beat?: number } | undefined

      if (typeof payload?.beat === 'number') {
        this.seek(payload.beat)
      }
    }
  }

  private handleClockEvent(event: ClockEvent): void {
    this.context?.events.emit({
      type: event.type,
      serviceId: this.id,
      payload: event.state
    })

    if (
      event.type === 'clock:tick' ||
      event.type === 'clock:seeked' ||
      event.type === 'clock:stopped'
    ) {
      this.context?.events.emit({
        type: 'transport:beat-changed',
        serviceId: this.id,
        payload: {
          currentBeat: event.state.beat,
          currentStep: Math.floor(event.state.beat)
        }
      })
    }

    this.emitStatus()
  }

  private emitStatus(): void {
    this.context?.events.emit({
      type: 'clock:status-changed',
      serviceId: this.id,
      payload: this.status
    })
  }
}
