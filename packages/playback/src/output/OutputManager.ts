import type { PlaybackEvent } from '../events.ts'
import type { OutputEvent, OutputEventListener } from './OutputEvent.ts'
import type { PlaybackOutput } from './PlaybackOutput.ts'
import { OutputRegistry } from './OutputRegistry.ts'

export interface OutputManagerStatus {
  readonly registeredOutputCount: number
  readonly activeOutputIds: readonly string[]
  readonly lastEventCount: number
}

export class OutputManager {
  readonly registry = new OutputRegistry()

  private readonly activeOutputIds = new Set<string>()
  private readonly listeners = new Set<OutputEventListener>()
  private lastEventCount = 0

  get status(): OutputManagerStatus {
    return {
      registeredOutputCount: this.registry.outputs().length,
      activeOutputIds: [...this.activeOutputIds],
      lastEventCount: this.lastEventCount
    }
  }

  async register(output: PlaybackOutput, active = true): Promise<PlaybackOutput> {
    const registered = this.registry.register(output)
    this.emit({ type: 'output:registered', outputId: output.id })

    if (active) {
      await this.connect(output.id)
    }

    return registered
  }

  async remove(outputId: string): Promise<PlaybackOutput | undefined> {
    await this.disconnect(outputId)
    const output = this.registry.remove(outputId)

    if (output) {
      this.emit({ type: 'output:removed', outputId })
    }

    return output
  }

  async connect(outputId: string): Promise<void> {
    const output = this.registry.get(outputId)

    if (!output || this.activeOutputIds.has(outputId)) return

    await output.connect()
    this.activeOutputIds.add(outputId)
    this.emit({ type: 'output:connected', outputId })
  }

  async disconnect(outputId: string): Promise<void> {
    const output = this.registry.get(outputId)

    if (!output || !this.activeOutputIds.has(outputId)) return

    await output.disconnect()
    this.activeOutputIds.delete(outputId)
    this.emit({ type: 'output:disconnected', outputId })
  }

  async disconnectAll(): Promise<void> {
    for (const outputId of [...this.activeOutputIds]) {
      await this.disconnect(outputId)
    }
  }

  handleEvents(events: readonly PlaybackEvent[]): void {
    const eventBatch = [...events]
    this.lastEventCount = eventBatch.length

    if (eventBatch.length === 0) return

    for (const outputId of this.activeOutputIds) {
      this.registry.get(outputId)?.handleEvents(eventBatch)
    }

    this.emit({ type: 'output:events', events: eventBatch })
  }

  panic(): void {
    for (const outputId of this.activeOutputIds) {
      this.registry.get(outputId)?.panic?.()
    }
  }

  panicTrack(trackId: string): void {
    for (const outputId of this.activeOutputIds) {
      this.registry.get(outputId)?.panicTrack?.(trackId)
    }
  }

  subscribe(listener: OutputEventListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: OutputEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
