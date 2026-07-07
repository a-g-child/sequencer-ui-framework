export interface NativeSchedulerWasmModule {
  set_model_json(modelJson: string): void
  start(position: number): void
  stop(): void
  seek(position: number): void
  tick_json(clockStateJson: string): string
  schedule_lookahead_json(window: number): string
  status_json(): string
}

export interface NativeSchedulerWasmStatus {
  readonly running: boolean
  readonly queuedEventCount: number
  readonly currentBeat: number
  readonly lookaheadDepthBeats: number
  readonly maxLookaheadDepthBeats: number
  readonly lookaheadDepthMs: number
  readonly maxLookaheadDepthMs: number
  readonly largestEventBatch: number
}

export function createNativeSchedulerWasmStub(): NativeSchedulerWasmModule {
  let modelJson = ''
  let running = false
  let currentBeat = 0

  return {
    set_model_json(nextModelJson: string): void {
      parseJsonObject(nextModelJson, 'NativePlaybackModel')
      modelJson = nextModelJson
    },

    start(position: number): void {
      running = true
      currentBeat = finiteNumber(position, 'start position')
    },

    stop(): void {
      running = false
      currentBeat = 0
    },

    seek(position: number): void {
      currentBeat = finiteNumber(position, 'seek position')
    },

    tick_json(clockStateJson: string): string {
      ensureModel(modelJson)
      const state = parseJsonObject(clockStateJson, 'NativeClockState')
      const beat = Number((state as { beat?: unknown }).beat)

      if (Number.isFinite(beat)) {
        currentBeat = beat
      }

      return '[]'
    },

    schedule_lookahead_json(window: number): string {
      ensureModel(modelJson)
      finiteNumber(window, 'lookahead window')

      return '[]'
    },

    status_json(): string {
      return JSON.stringify({
        running,
        queuedEventCount: 0,
        currentBeat,
        lookaheadDepthBeats: 0,
        maxLookaheadDepthBeats: 0,
        lookaheadDepthMs: 0,
        maxLookaheadDepthMs: 0,
        largestEventBatch: 0
      } satisfies NativeSchedulerWasmStatus)
    }
  }
}

function ensureModel(modelJson: string): void {
  if (!modelJson) {
    throw new Error('Native scheduler WASM model has not been set')
  }
}

function parseJsonObject(json: string, label: string): unknown {
  const value = JSON.parse(json) as unknown

  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} JSON must decode to an object`)
  }

  return value
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Native scheduler WASM ${label} must be finite`)
  }

  return value
}
