import type { EngineCommand } from './schemas.ts'
import type { RuntimeBackend, RuntimeSnapshot } from './RuntimeBackend.ts'

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

export interface PlaybackRuntimeControllerOptions {
  readonly pollIntervalMs?: number
  readonly autoPoll?: boolean
}

export type PlaybackRuntimeControllerListener = (
  status: PlaybackRuntimeControllerStatus
) => void

export class PlaybackRuntimeController {
  private readonly pollIntervalMs: number
  private readonly autoPoll: boolean
  private readonly listeners = new Set<PlaybackRuntimeControllerListener>()
  private pollTimer?: ReturnType<typeof setInterval>
  private commandSequence = 1
  private currentState: PlaybackRuntimeControllerState = 'stopped'
  private requestedTransportPlaying = false
  private commandPending = false
  private failure: string | undefined
  private latestSnapshot: RuntimeSnapshot | undefined

  constructor(
    private readonly backend: RuntimeBackend,
    options: PlaybackRuntimeControllerOptions = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 40
    this.autoPoll = options.autoPoll ?? true
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
    if (this.currentState === 'starting') return

    this.currentState = 'starting'
    this.failure = undefined
    this.emit()

    try {
      await this.backend.start()
      this.currentState = 'ready'
      await this.refreshSnapshot()
      this.startPolling()
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  async play(): Promise<void> {
    await this.sendTransportCommand('transport:start', true)
  }

  async stop(): Promise<void> {
    await this.sendTransportCommand('transport:stop', false)
  }

  async panic(): Promise<void> {
    await this.sendTransportCommand('panic', false)
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
      await this.refreshSnapshot()
    } catch (error) {
      this.fail(error)
      throw error
    }
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

  private fail(error: unknown): void {
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
