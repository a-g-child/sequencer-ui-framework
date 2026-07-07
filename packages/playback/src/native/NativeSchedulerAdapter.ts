import type { BeatTime } from '@sequencer/core'
import type { ClockState } from '../clock.ts'
import type { PlaybackEvent } from '../events.ts'
import type { PlaybackModel } from '../model.ts'
import {
  TypeScriptScheduler,
  type Scheduler,
  type SchedulerStatus,
  type TypeScriptSchedulerOptions
} from '../scheduler.ts'

export class NativeSchedulerAdapter implements Scheduler {
  private readonly scheduler: Scheduler

  constructor(options: TypeScriptSchedulerOptions = {}, scheduler?: Scheduler) {
    this.scheduler = scheduler ?? new TypeScriptScheduler(options)
  }

  get status(): SchedulerStatus {
    return this.scheduler.status
  }

  setModel(model: PlaybackModel): void {
    this.scheduler.setModel(model)
  }

  start(position: BeatTime): void {
    this.scheduler.start(position)
  }

  stop(): void {
    this.scheduler.stop()
  }

  seek(position: BeatTime): void {
    this.scheduler.seek(position)
  }

  tick(state: ClockState): readonly PlaybackEvent[] {
    return this.scheduler.tick(state)
  }

  scheduleLookahead(window: number): readonly PlaybackEvent[] {
    return this.scheduler.scheduleLookahead(window)
  }
}
