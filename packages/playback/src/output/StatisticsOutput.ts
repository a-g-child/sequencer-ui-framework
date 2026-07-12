import type { PlaybackEvent } from '../events.ts'
import type { SchedulerStatus } from '../scheduler.ts'
import { observationCapabilities } from './OutputEvent.ts'
import type { PlaybackOutput } from './PlaybackOutput.ts'

export interface PlaybackOutputStatistics {
  readonly eventCount: number
  readonly eventsPerSecond: number
  readonly droppedEvents: number
  readonly schedulerJitterMs: number
  readonly schedulerLatencyMs: number
  readonly maxSchedulerLatencyMs: number
  readonly lateEventCount: number
  readonly missedEventCount: number
  readonly lastBatchSize: number
  readonly largestEventBatch: number
  readonly queueDepth: number
  readonly maxQueueDepth: number
  readonly lookaheadDepthBeats: number
  readonly maxLookaheadDepthBeats: number
  readonly lookaheadDepthMs: number
  readonly maxLookaheadDepthMs: number
  readonly playbackModelRebuildMs: number
}

export interface SchedulerFrameDiagnostics {
  readonly clockTimeMs: number
  readonly dispatchTimeMs: number
  readonly events: readonly PlaybackEvent[]
  readonly schedulerStatus: SchedulerStatus
}

export class StatisticsOutput implements PlaybackOutput {
  readonly id = 'statistics'
  readonly name = 'Statistics Output'
  readonly capabilities = observationCapabilities

  private connectedAt = 0
  private eventCount = 0
  private droppedEvents = 0
  private lateEventCount = 0
  private missedEventCount = 0
  private lastBatchSize = 0
  private largestEventBatch = 0
  private queueDepth = 0
  private maxQueueDepth = 0
  private previousEventTimeMs: number | undefined
  private previousSchedulerLatencyMs: number | undefined
  private jitterTotalMs = 0
  private jitterSampleCount = 0
  private schedulerLatencyTotalMs = 0
  private schedulerLatencySampleCount = 0
  private maxSchedulerLatencyMs = 0
  private lookaheadDepthBeats = 0
  private maxLookaheadDepthBeats = 0
  private lookaheadDepthMs = 0
  private maxLookaheadDepthMs = 0
  private playbackModelRebuildMs = 0

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
      lateEventCount: this.lateEventCount,
      missedEventCount: this.missedEventCount,
      schedulerJitterMs:
        this.jitterSampleCount > 0 ? this.jitterTotalMs / this.jitterSampleCount : 0,
      schedulerLatencyMs:
        this.schedulerLatencySampleCount > 0
          ? this.schedulerLatencyTotalMs / this.schedulerLatencySampleCount
          : 0,
      maxSchedulerLatencyMs: this.maxSchedulerLatencyMs,
      lastBatchSize: this.lastBatchSize,
      largestEventBatch: this.largestEventBatch,
      queueDepth: this.queueDepth,
      maxQueueDepth: this.maxQueueDepth,
      lookaheadDepthBeats: this.lookaheadDepthBeats,
      maxLookaheadDepthBeats: this.maxLookaheadDepthBeats,
      lookaheadDepthMs: this.lookaheadDepthMs,
      maxLookaheadDepthMs: this.maxLookaheadDepthMs,
      playbackModelRebuildMs: this.playbackModelRebuildMs
    }
  }

  handleEvents(events: PlaybackEvent[]): void {
    this.eventCount += events.length
    this.lastBatchSize = events.length
    this.largestEventBatch = Math.max(this.largestEventBatch, events.length)

    for (const event of events) {
      if (this.previousEventTimeMs !== undefined) {
        this.jitterTotalMs += Math.abs(event.timeMs - this.previousEventTimeMs)
        this.jitterSampleCount += 1
      }

      this.previousEventTimeMs = event.timeMs

      if (event.timeMs < nowMs()) {
        this.lateEventCount += 1
      }
    }
  }

  recordSchedulerFrame(frame: SchedulerFrameDiagnostics): void {
    const schedulerLatencyMs = Math.max(0, frame.dispatchTimeMs - frame.clockTimeMs)

    this.schedulerLatencyTotalMs += schedulerLatencyMs
    this.schedulerLatencySampleCount += 1
    this.maxSchedulerLatencyMs = Math.max(
      this.maxSchedulerLatencyMs,
      schedulerLatencyMs
    )
    this.queueDepth = frame.schedulerStatus.queuedEventCount
    this.maxQueueDepth = Math.max(this.maxQueueDepth, this.queueDepth)
    this.lookaheadDepthBeats = frame.schedulerStatus.lookaheadDepthBeats
    this.maxLookaheadDepthBeats = Math.max(
      this.maxLookaheadDepthBeats,
      this.lookaheadDepthBeats
    )
    this.lookaheadDepthMs = frame.schedulerStatus.lookaheadDepthMs
    this.maxLookaheadDepthMs = Math.max(
      this.maxLookaheadDepthMs,
      this.lookaheadDepthMs
    )

    if (this.previousSchedulerLatencyMs !== undefined) {
      this.jitterTotalMs += Math.abs(
        schedulerLatencyMs - this.previousSchedulerLatencyMs
      )
      this.jitterSampleCount += 1
    }

    this.previousSchedulerLatencyMs = schedulerLatencyMs
  }

  recordPlaybackModelRebuild(durationMs: number): void {
    this.playbackModelRebuildMs = Math.max(0, durationMs)
  }
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
