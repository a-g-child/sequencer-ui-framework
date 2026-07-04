import type { PlaybackEvent } from '../events'
import { observationCapabilities } from './OutputEvent'
import type { PlaybackOutput } from './PlaybackOutput'

export class EventLoggerOutput implements PlaybackOutput {
  readonly id = 'event-logger'
  readonly name = 'Event Logger'
  readonly capabilities = observationCapabilities
  readonly filename = 'timeline.jsonl'

  private lines: string[] = []

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  handleEvents(events: PlaybackEvent[]): void {
    this.lines.push(...events.map((event) => JSON.stringify(event)))
  }

  jsonl(): string {
    return this.lines.join('\n')
  }

  clear(): void {
    this.lines = []
  }
}
