import type { DocumentObserver, Operation, Service, ServiceContext, ServiceEvent } from '@sequencer/core'
import { PlaybackModelBuilder } from './builder'
import type { ClockState } from './clock'
import type { PlaybackEvent } from './events'
import type { PlaybackModel } from './model'
import { ConsoleMidiOutput } from './output'
import { TypeScriptScheduler, type Scheduler, type SchedulerStatus } from './scheduler'

export interface PlaybackServiceStatus extends SchedulerStatus {
  readonly modelId: string
  readonly noteCount: number
}

export class PlaybackService implements Service, DocumentObserver {
  readonly id = 'playback'
  readonly name = 'Playback'

  private context?: ServiceContext
  private model?: PlaybackModel
  private runtimeBpm?: number
  private readonly builder = new PlaybackModelBuilder()
  private readonly scheduler: Scheduler & { readonly status?: SchedulerStatus }
  private unsubscribeServiceEvents?: () => void

  constructor(scheduler?: Scheduler & { readonly status?: SchedulerStatus }) {
    this.scheduler =
      scheduler ?? new TypeScriptScheduler({ output: new ConsoleMidiOutput() })
  }

  initialise(context: ServiceContext): void {
    this.context = context
    context.documentStore.addObserver(this)
    this.unsubscribeServiceEvents = context.events.subscribe((event) =>
      this.handleServiceEvent(event)
    )
    this.rebuildModel()
    this.emitStatus()
  }

  shutdown(): void {
    this.scheduler.stop()
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
      noteCount: this.model?.notes.length ?? 0
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
      this.scheduler.tick(event.payload as ClockState)
      this.emitStatus()
    }
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
