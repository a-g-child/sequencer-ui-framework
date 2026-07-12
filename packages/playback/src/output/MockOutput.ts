import type { PlaybackEvent } from '../events.ts'
import { observationCapabilities } from './OutputEvent.ts'
import type { PlaybackOutput } from './PlaybackOutput.ts'

export class MockOutput implements PlaybackOutput {
  readonly id = 'mock'
  readonly name = 'Mock Output'
  readonly capabilities = observationCapabilities

  private readonly receivedEvents: PlaybackEvent[] = []

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  handleEvents(events: PlaybackEvent[]): void {
    this.receivedEvents.push(...events)
  }

  events(): readonly PlaybackEvent[] {
    return this.receivedEvents
  }

  clear(): void {
    this.receivedEvents.length = 0
  }
}
