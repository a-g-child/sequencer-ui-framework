import type { DocumentObserver, Operation, Service, ServiceContext, ServiceEvent } from '@sequencer/core'
import { PlaybackModelBuilder } from './builder'
import type { ClockState } from './clock'
import type { PlaybackEvent } from './events'
import type { PlaybackModel } from './model'
import {
  ConsoleOutput,
  EventLoggerOutput,
  MidiOutputStub,
  OutputManager,
  StatisticsOutput,
  type OutputManagerStatus
} from './output'
import type { PlaybackOutputStatistics } from './output/StatisticsOutput'
import {
  samplePlaybackAutomationValues,
  TypeScriptScheduler,
  type PlaybackRuntimeParameterValue,
  type Scheduler,
  type SchedulerStatus
} from './scheduler'

export interface PlaybackServiceStatus extends SchedulerStatus {
  readonly modelId: string
  readonly noteCount: number
  readonly outputManager: OutputManagerStatus
  readonly statistics: PlaybackOutputStatistics
}

export class PlaybackService implements Service, DocumentObserver {
  readonly id = 'playback'
  readonly name = 'Playback'

  private context?: ServiceContext
  private model?: PlaybackModel
  private runtimeBpm?: number
  private activeClipByTrackId: Record<string, string | undefined> = {}
  private readonly builder = new PlaybackModelBuilder()
  private readonly scheduler: Scheduler & { readonly status?: SchedulerStatus }
  private readonly outputManager = new OutputManager()
  private readonly statisticsOutput = new StatisticsOutput()
  private unsubscribeServiceEvents?: () => void

  constructor(scheduler?: Scheduler & { readonly status?: SchedulerStatus }) {
    this.scheduler = scheduler ?? new TypeScriptScheduler()
  }

  async initialise(context: ServiceContext): Promise<void> {
    this.context = context
    context.documentStore.addObserver(this)
    this.unsubscribeServiceEvents = context.events.subscribe((event) =>
      this.handleServiceEvent(event)
    )
    await this.initialiseOutputs()
    this.rebuildModel()
    this.emitStatus()
  }

  async shutdown(): Promise<void> {
    this.scheduler.stop()
    await this.outputManager.disconnectAll()
    this.context?.documentStore.removeObserver(this)
    this.unsubscribeServiceEvents?.()
    this.context = undefined
  }

  get status(): PlaybackServiceStatus {
    const status = this.scheduler.status ?? {
      running: false,
      queuedEventCount: 0,
      currentBeat: 0,
      lastEmittedEvent: undefined,
      lookaheadDepthBeats: 0,
      maxLookaheadDepthBeats: 0,
      lookaheadDepthMs: 0,
      maxLookaheadDepthMs: 0,
      largestEventBatch: 0
    }

    return {
      ...status,
      modelId: this.model?.id ?? '',
      noteCount: this.model?.notes.length ?? 0,
      outputManager: this.outputManager.status,
      statistics: this.statisticsOutput.statistics
    }
  }

  onCommandExecuted(_operation: Operation): void {
    this.rebuildModel()
  }

  onCommandUndone(_operation: Operation): void {
    this.rebuildModel()
  }

  onCommandRedone(_operation: Operation): void {
    this.rebuildModel()
  }

  setActiveClipForTrack(trackId: string, clipId: string | undefined): void {
    const nextActiveClipByTrackId = { ...this.activeClipByTrackId }

    if (clipId) {
      nextActiveClipByTrackId[trackId] = clipId
    } else {
      delete nextActiveClipByTrackId[trackId]
    }

    this.activeClipByTrackId = nextActiveClipByTrackId
    this.rebuildModel()
  }

  activeClipForTrack(trackId: string): string | undefined {
    return this.activeClipByTrackId[trackId]
  }

  private rebuildModel(): void {
    if (!this.context) return

    const startedAt = nowMs()
    this.model = this.builder.build(
      this.context.documentStore.document,
      this.runtimeBpm,
      { activeClipByTrackId: this.activeClipByTrackId }
    )
    this.scheduler.setModel(this.model)
    this.statisticsOutput.recordPlaybackModelRebuild(nowMs() - startedAt)
    this.emitStatus()
  }

  private handleServiceEvent(event: ServiceEvent): void {
    if (event.serviceId === this.id) return

    if (event.type === 'clock:started') {
      const state = event.payload as ClockState
      this.runtimeBpm = state.bpm
      this.rebuildModel()
      this.scheduler.start(state.beat)
      this.emitStatus()
    }

    if (event.type === 'clock:stopped') {
      this.scheduler.stop()
      this.emitStatus()
    }

    if (event.type === 'clock:seeked') {
      const state = event.payload as ClockState
      this.scheduler.seek(state.beat)
      this.emitStatus()
    }

    if (event.type === 'clock:tempo-changed') {
      const state = event.payload as ClockState
      this.runtimeBpm = state.bpm
      this.rebuildModel()
    }

    if (event.type === 'clock:tick') {
      const state = event.payload as ClockState
      const events = this.scheduler.tick(state)
      const dispatchTimeMs = nowMs()

      this.statisticsOutput.recordSchedulerFrame({
        clockTimeMs: state.timeMs,
        dispatchTimeMs,
        events,
        schedulerStatus: this.status
      })
      this.outputManager.handleEvents(events)
      this.emitPlaybackEvents(events)
      this.emitRuntimeParameterValues(state)
      this.emitStatus()
    }
  }

  private async initialiseOutputs(): Promise<void> {
    if (this.outputManager.registry.outputs().length > 0) return

    await this.outputManager.register(new ConsoleOutput())
    await this.outputManager.register(new MidiOutputStub(), false)
    await this.outputManager.register(new EventLoggerOutput(), false)
    await this.outputManager.register(this.statisticsOutput)
  }

  private emitStatus(): void {
    this.context?.events.emit({
      type: 'playback:status-changed',
      serviceId: this.id,
      payload: this.status
    })
  }

  private emitPlaybackEvents(events: readonly PlaybackEvent[]): void {
    if (events.length === 0) return

    this.context?.events.emit({
      type: 'playback:events',
      serviceId: this.id,
      payload: events
    })
  }

  private emitRuntimeParameterValues(state: ClockState): void {
    if (!this.model) return

    const values = samplePlaybackAutomationValues(this.model, state.beat)

    this.context?.events.emit<readonly PlaybackRuntimeParameterValue[]>({
      type: 'playback:runtime-parameters',
      serviceId: this.id,
      payload: values
    })
  }

}

export type { PlaybackEvent }

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
