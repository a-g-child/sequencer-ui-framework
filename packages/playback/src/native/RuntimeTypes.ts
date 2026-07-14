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
    readonly scheduler?: {
      readonly ownerGenerationsSet: number
      readonly sampleEventsInserted: number
      readonly beatEventsInserted: number
      readonly beatEventMinSample?: number | null
      readonly beatEventMaxSample?: number | null
      readonly firstScheduledEventVisitedSample?: number | null
      readonly firstScheduledEventDispatchedSample?: number | null
      readonly eventsDroppedCapacity: number
      readonly eventsDroppedNotPlaying: number
      readonly eventsSuppressedWhileStopped: number
      readonly eventsDiscardedOwner: number
      readonly eventsDiscardedFutureOwner: number
      readonly noteOnsDispatched: number
      readonly noteOffsDispatched: number
      readonly loopReschedules: number
      readonly loopRescheduleSkippedDisabled: number
      readonly loopRescheduleSkippedOutside: number
      readonly eventsCleared: number
      readonly transportLoopEnabled: boolean
      readonly transportLoopStartSample: number
      readonly transportLoopEndSample: number
    }
    readonly eventGraph?: {
      readonly eventsReceived: number
      readonly routeDispatches: number
      readonly eventsEmitted: number
      readonly eventsSuppressed: number
      readonly eventsDroppedCapacity: number
      readonly eventsDroppedDepth: number
      readonly eventsDroppedBudget: number
      readonly futureEventsRequested: number
      readonly futureEventsRejectedLate: number
      readonly futureEventsDroppedCapacity: number
      readonly futureEventsDroppedSchedulerFull: number
      readonly futureEventsDiscardedPlanRevision: number
      readonly futureEventsDiscardedGeneration: number
    }
    readonly recentEventTraces?: readonly RuntimeEventTrace[]
  }
  readonly samplePosition: number
  readonly sampleRate: number
  readonly running: boolean
  readonly native?: unknown
}

export interface RuntimeEventTrace {
  readonly traceId: {
    readonly clipOwnerId: number
    readonly generation: number
    readonly noteId: number
    readonly role: 'note-on' | 'note-off'
  }
  readonly receivedBeat: number
  readonly resolvedSample: number
  readonly loopIteration: number
  readonly visitedSample?: number | null
  readonly dispatchedSample?: number | null
  readonly dropReason?:
    | 'stale-generation'
    | 'stale-plan-revision'
    | 'transport-stopped'
    | 'scheduler-capacity'
    | null
  readonly noteOnReceivedSample?: number | null
  readonly noteOffReceivedSample?: number | null
  readonly voiceAllocatedSample?: number | null
  readonly voiceReleasedSample?: number | null
  readonly activeVoiceCount?: number | null
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
