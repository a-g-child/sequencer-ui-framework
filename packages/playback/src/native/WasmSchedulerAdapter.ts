import type { NativeSchedulerWasmModule } from '@sequencer/native-scheduler-wasm'
import type { BeatTime } from '@sequencer/core'
import type { ClockState } from '../clock.ts'
import type { PlaybackEvent } from '../events.ts'
import type { PlaybackModel } from '../model.ts'
import type { Scheduler, SchedulerStatus } from '../scheduler.ts'

export class WasmSchedulerAdapter implements Scheduler {
  private readonly wasm: NativeSchedulerWasmModule

  constructor(wasm: NativeSchedulerWasmModule) {
    this.wasm = wasm
  }

  get status(): SchedulerStatus {
    return parseSchedulerStatus(this.wasm.status_json())
  }

  setModel(model: PlaybackModel): void {
    this.wasm.set_model_json(JSON.stringify(model))
  }

  start(position: BeatTime): void {
    this.wasm.start(position)
  }

  stop(): void {
    this.wasm.stop()
  }

  seek(position: BeatTime): void {
    this.wasm.seek(position)
  }

  tick(state: ClockState): readonly PlaybackEvent[] {
    return parsePlaybackEvents(this.wasm.tick_json(JSON.stringify(state)))
  }

  scheduleLookahead(window: number): readonly PlaybackEvent[] {
    return parsePlaybackEvents(this.wasm.schedule_lookahead_json(window))
  }
}

function parsePlaybackEvents(json: string): readonly PlaybackEvent[] {
  const value = JSON.parse(json) as unknown

  if (!Array.isArray(value)) {
    throw new Error('Native scheduler WASM returned non-array events JSON')
  }

  return value as PlaybackEvent[]
}

function parseSchedulerStatus(json: string): SchedulerStatus {
  const value = JSON.parse(json) as Partial<SchedulerStatus>

  return {
    running: Boolean(value.running),
    queuedEventCount: numberValue(value.queuedEventCount),
    currentBeat: numberValue(value.currentBeat),
    lastEmittedEvent: value.lastEmittedEvent,
    lookaheadDepthBeats: numberValue(value.lookaheadDepthBeats),
    maxLookaheadDepthBeats: numberValue(value.maxLookaheadDepthBeats),
    lookaheadDepthMs: numberValue(value.lookaheadDepthMs),
    maxLookaheadDepthMs: numberValue(value.maxLookaheadDepthMs),
    largestEventBatch: numberValue(value.largestEventBatch)
  }
}

function numberValue(value: unknown): number {
  const number = Number(value)

  return Number.isFinite(number) ? number : 0
}
