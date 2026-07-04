import type { PlaybackEvent } from '../events'
import { observationCapabilities } from './OutputEvent'
import type { PlaybackOutput } from './PlaybackOutput'

export interface PlaybackOutputStatistics {
  readonly eventCount: number
  readonly eventsPerSecond: number
  readonly droppedEvents: number
  readonly schedulerJitterMs: number
}

export class StatisticsOutput implements PlaybackOutput {
  readonly id = 'statistics'
  readonly name = 'Statistics Output'
  readonly capabilities = observationCapabilities

  private connectedAt = 0
  private eventCount = 0
  private droppedEvents = 0
  private previousEventTimeMs: number | undefined
  private jitterTotalMs = 0
  private jitterSampleCount = 0

  async connect(): Promise<void> {
    this.connectedAt = nowMs()
  }

  async disconnect(): Promise<void> {}

  get statistics(): PlaybackOutputStatistics {
    const elapsedSeconds = Math.max(0.001, (nowMs() - this.connectedAt) / 1000)

    return {
      eventCount: this.eventCount,
      eventsPerSecond: this.eventCount / elapsedSeconds,
      droppedEvents: this.droppedEvents,
      schedulerJitterMs:
        this.jitterSampleCount > 0 ? this.jitterTotalMs / this.jitterSampleCount : 0
    }
  }

  handleEvents(events: PlaybackEvent[]): void {
    this.eventCount += events.length

    for (const event of events) {
      if (this.previousEventTimeMs !== undefined) {
        this.jitterTotalMs += Math.abs(event.timeMs - this.previousEventTimeMs)
        this.jitterSampleCount += 1
      }

      this.previousEventTimeMs = event.timeMs
    }
  }
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
