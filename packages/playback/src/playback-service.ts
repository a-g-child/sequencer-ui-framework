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
import { TypeScriptScheduler, type Scheduler, type SchedulerStatus } from './scheduler'

export interface PlaybackServiceStatus extends SchedulerStatus {
  readonly modelId: string
  readonly noteCount: number
  readonly outputManager: OutputManagerStatus
}

export class PlaybackService implements Service, DocumentObserver {
  readonly id = 'playback'
  readonly name = 'Playback'

  private context?: ServiceContext
  private model?: PlaybackModel
  private runtimeBpm?: number
  private readonly builder = new PlaybackModelBuilder()
  private readonly scheduler: Scheduler & { readonly status?: SchedulerStatus }
  private readonly outputManager = new OutputManager()
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
      lastEmittedEvent: undefined
    }

    return {
      ...status,
      modelId: this.model?.id ?? '',
      noteCount: this.model?.notes.length ?? 0,
      outputManager: this.outputManager.status
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

  private rebuildModel(): void {
    if (!this.context) return

    this.model = this.builder.build(
      this.context.documentStore.document,
      this.runtimeBpm
    )
    this.scheduler.setModel(this.model)
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
      const events = this.scheduler.tick(event.payload as ClockState)

      this.outputManager.handleEvents(events)
      this.emitStatus()
    }
  }

  private async initialiseOutputs(): Promise<void> {
    if (this.outputManager.registry.outputs().length > 0) return

    await this.outputManager.register(new ConsoleOutput())
    await this.outputManager.register(new MidiOutputStub(), false)
    await this.outputManager.register(new EventLoggerOutput(), false)
    await this.outputManager.register(new StatisticsOutput(), false)
  }

  private emitStatus(): void {
    this.context?.events.emit({
      type: 'playback:status-changed',
      serviceId: this.id,
      payload: this.status
    })
  }

}

export type { PlaybackEvent }
