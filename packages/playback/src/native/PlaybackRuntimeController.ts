import type { NativeExecutionPlan } from '@sequencer/audio-graph'
import type { EngineCommand } from './schemas.ts'
import type {
  PlaybackRuntimeControllerListener,
  PlaybackRuntimeControllerState,
  PlaybackRuntimeControllerStatus,
  RuntimeSnapshot
} from './RuntimeTypes.ts'
import type { PreparedRuntimeHandle, RuntimeCompilePlan } from './RuntimeBackend.ts'

export interface PlaybackRuntimeBackend {
  start(): Promise<void>
  compile(plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle>
  activate(handle: PreparedRuntimeHandle): Promise<void>
  sendCommands(commands: readonly EngineCommand[]): void
  getSnapshot(): Promise<RuntimeSnapshot>
  dispose(): Promise<void>
}

export interface PlaybackRuntimeControllerOptions {
  readonly pollIntervalMs?: number
  readonly autoPoll?: boolean
  readonly activationConfirmTimeoutMs?: number
  readonly transportConfirmTimeoutMs?: number
}

export class PlaybackRuntimeController {
  private readonly pollIntervalMs: number
  private readonly autoPoll: boolean
  private readonly activationConfirmTimeoutMs: number
  private readonly transportConfirmTimeoutMs: number
  private readonly listeners = new Set<PlaybackRuntimeControllerListener>()
  private pollTimer?: ReturnType<typeof setInterval>
  private commandSequence = 1
  private currentState: PlaybackRuntimeControllerState = 'stopped'
  private requestedTransportPlaying = false
  private commandPending = false
  private failure: string | undefined
  private latestSnapshot: RuntimeSnapshot | undefined
  private startPromise: Promise<void> | undefined

  constructor(
    private readonly backend: PlaybackRuntimeBackend,
    options: PlaybackRuntimeControllerOptions = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 40
    this.autoPoll = options.autoPoll ?? true
    this.activationConfirmTimeoutMs = options.activationConfirmTimeoutMs ?? 750
    this.transportConfirmTimeoutMs = options.transportConfirmTimeoutMs ?? 500
  }

  get status(): PlaybackRuntimeControllerStatus {
    return {
      state: this.currentState,
      requestedTransportPlaying: this.requestedTransportPlaying,
      commandPending: this.commandPending,
      failure: this.failure,
      snapshot: this.latestSnapshot
    }
  }

  subscribe(listener: PlaybackRuntimeControllerListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  async start(): Promise<void> {
    if (this.currentState === 'ready') return
    if (this.currentState === 'starting') {
      await this.startPromise
      return
    }

    this.currentState = 'starting'
    this.failure = undefined
    this.emit()

    this.startPromise = (async () => {
      await this.backend.start()
      this.currentState = 'ready'
      await this.refreshSnapshot()
      this.startPolling()
    })()

    try {
      await this.startPromise
    } catch (error) {
      this.fail(error)
      throw error
    } finally {
      this.startPromise = undefined
    }
  }

  async compileAndActivate(plan: NativeExecutionPlan): Promise<RuntimeSnapshot> {
    await this.start()

    try {
      const handle = await this.backend.compile(plan)
      await this.backend.activate(handle)
      const snapshot = await this.waitForActivationConfirmation(handle)
      return snapshot
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  private async waitForActivationConfirmation(
    handle: PreparedRuntimeHandle
  ): Promise<RuntimeSnapshot> {
    const expectedPlanId = Number(handle.planId)
    const expectedRevision = handle.backend === 'native' ? handle.revision : null
    const deadline = nowMs() + this.activationConfirmTimeoutMs
    let snapshot = await this.refreshSnapshot()

    while (
      !activationConfirmed(snapshot, expectedPlanId, expectedRevision) &&
      snapshot.plan.pendingTransfers > 0 &&
      nowMs() < deadline
    ) {
      await wait(Math.min(this.pollIntervalMs, Math.max(1, deadline - nowMs())))
      snapshot = await this.refreshSnapshot()
    }

    if (!activationConfirmed(snapshot, expectedPlanId, expectedRevision)) {
      if (!Number.isNaN(expectedPlanId) && snapshot.plan.activePlanId !== expectedPlanId) {
        throw new Error(
          `runtime activation did not confirm plan ${expectedPlanId}; observed ${snapshot.plan.activePlanId}`
        )
      }

      if (expectedRevision !== null && snapshot.plan.activeRevision !== expectedRevision) {
        throw new Error(
          `runtime activation did not confirm revision ${expectedRevision}; observed ${snapshot.plan.activeRevision}`
        )
      }
    }

    return snapshot
  }

  async play(): Promise<void> {
    await this.sendTransportCommand('transport:start', true)
  }

  async stop(): Promise<void> {
    if (this.currentState === 'failed' || this.currentState === 'stopped') {
      this.requestedTransportPlaying = false
      this.commandPending = false
      this.emit()
      return
    }

    await this.sendTransportCommand('transport:stop', false)
  }

  async panic(): Promise<void> {
    if (this.currentState === 'failed' || this.currentState === 'stopped') {
      this.requestedTransportPlaying = false
      this.commandPending = false
      this.emit()
      return
    }

    await this.sendTransportCommand('panic', false)
  }

  sendCommands(commands: readonly EngineCommand[]): void {
    this.ensureReady()
    this.backend.sendCommands(commands)
  }

  async refreshSnapshot(): Promise<RuntimeSnapshot> {
    this.ensureReady()

    try {
      const snapshot = await this.backend.getSnapshot()

      this.latestSnapshot = snapshot
      this.commandPending =
        snapshot.transport.playing !== this.requestedTransportPlaying
      this.emit()

      return snapshot
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  async dispose(): Promise<void> {
    this.stopPolling()

    try {
      await this.backend.dispose()
    } finally {
      this.currentState = 'stopped'
      this.commandPending = false
      this.latestSnapshot = undefined
      this.emit()
    }
  }

  private async sendTransportCommand(
    type: 'transport:start' | 'transport:stop' | 'panic',
    requestedPlaying: boolean
  ): Promise<void> {
    this.ensureReady()
    this.requestedTransportPlaying = requestedPlaying
    this.commandPending = true
    this.failure = undefined
    this.emit()

    try {
      this.backend.sendCommands([
        {
          id: `runtime-${this.commandSequence++}`,
          type,
          timeMs: nowMs(),
          atSample: this.latestSnapshot?.transport.samplePosition ?? 0
        } as EngineCommand
      ])
      await this.waitForTransportConfirmation(requestedPlaying)
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  private async waitForTransportConfirmation(
    requestedPlaying: boolean
  ): Promise<RuntimeSnapshot> {
    const deadline = nowMs() + this.transportConfirmTimeoutMs
    let snapshot = await this.refreshSnapshot()

    while (snapshot.transport.playing !== requestedPlaying && nowMs() < deadline) {
      await wait(Math.min(this.pollIntervalMs, Math.max(1, deadline - nowMs())))
      snapshot = await this.refreshSnapshot()
    }

    if (snapshot.transport.playing !== requestedPlaying) {
      throw new Error(
        `runtime transport did not confirm ${
          requestedPlaying ? 'start' : 'stop'
        }; observed ${snapshot.transport.playing ? 'playing' : 'stopped'}`
      )
    }

    return snapshot
  }

  private ensureReady(): void {
    if (this.currentState !== 'ready') {
      throw new Error(`playback runtime controller is not ready: ${this.currentState}`)
    }
  }

  private startPolling(): void {
    if (!this.autoPoll || this.pollTimer) return

    this.pollTimer = setInterval(() => {
      void this.refreshSnapshot().catch(() => {
        // refreshSnapshot already records the failure for observers.
      })
    }, this.pollIntervalMs)
  }

  private stopPolling(): void {
    if (!this.pollTimer) return

    clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  fail(error: unknown): void {
    this.currentState = 'failed'
    this.commandPending = false
    this.failure = error instanceof Error ? error.message : String(error)
    this.emit()
  }

  private emit(): void {
    const status = this.status

    for (const listener of this.listeners) {
      listener(status)
    }
  }
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}

function activationConfirmed(
  snapshot: RuntimeSnapshot,
  expectedPlanId: number,
  expectedRevision: number | null
): boolean {
  const planMatches =
    Number.isNaN(expectedPlanId) || snapshot.plan.activePlanId === expectedPlanId
  const revisionMatches =
    expectedRevision === null || snapshot.plan.activeRevision === expectedRevision

  return planMatches && revisionMatches
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
