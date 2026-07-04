import type { DocumentObserver, Operation, Service, ServiceContext, ServiceEvent } from '@sequencer/core'
import { PlaybackModelBuilder } from './builder'
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
  private timer: ReturnType<typeof setInterval> | undefined

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
    this.stopClock()
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

    if (event.type === 'transport:playing-changed') {
      const payload = event.payload as { playing?: boolean } | undefined

      if (payload?.playing) {
        this.scheduler.start(this.readTransportBeat())
        this.startClock()
      } else {
        this.stopClock()
        this.scheduler.stop()
      }

      this.emitStatus()
    }

    if (event.type === 'transport:tempo-changed') {
      this.runtimeBpm = (event.payload as { bpm?: number } | undefined)?.bpm

      this.rebuildModel()
    }
  }

  private startClock(): void {
    if (this.timer) return

    this.timer = setInterval(() => {
      this.scheduler.tick(nowMs())
      this.emitStatus()
      this.emitBeatChanged()
    }, 25)
  }

  private stopClock(): void {
    if (!this.timer) return

    clearInterval(this.timer)
    this.timer = undefined
  }

  private emitStatus(): void {
    this.context?.events.emit({
      type: 'playback:status-changed',
      serviceId: this.id,
      payload: this.status
    })
  }

  private emitBeatChanged(): void {
    this.context?.events.emit({
      type: 'playback:beat-changed',
      serviceId: this.id,
      payload: { currentBeat: this.status.currentBeat }
    })
  }

  private readTransportBeat(): number {
    return this.context?.application.editorTransport.currentBeat ?? 0
  }
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}

export type { PlaybackEvent }
