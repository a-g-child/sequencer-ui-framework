export interface RuntimeSnapshot {
  readonly backend: 'web-audio' | 'native'
  readonly transport: {
    readonly playing: boolean
    readonly samplePosition: number
    readonly beatPosition: number
    readonly loopIteration: number
  }
  readonly stream: {
    readonly sampleRate: number
    readonly callbackCount: number
  }
  readonly plan: {
    readonly activePlanId: number | null
    readonly activeRevision: number | null
    readonly pendingTransfers: number
  }
  readonly diagnostics: {
    readonly xruns: number
    readonly queueOverflows: number
  }
  readonly samplePosition: number
  readonly sampleRate: number
  readonly running: boolean
  readonly native?: unknown
}

export type PlaybackRuntimeControllerState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'failed'

export interface PlaybackRuntimeControllerStatus {
  readonly state: PlaybackRuntimeControllerState
  readonly requestedTransportPlaying: boolean
  readonly commandPending: boolean
  readonly failure?: string
  readonly snapshot?: RuntimeSnapshot
}

export type PlaybackRuntimeControllerListener = (
  status: PlaybackRuntimeControllerStatus
) => void
