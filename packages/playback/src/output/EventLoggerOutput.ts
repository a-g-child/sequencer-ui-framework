import type { PlaybackEvent } from '../events.ts'
import { observationCapabilities } from './OutputEvent.ts'
import type { PlaybackOutput } from './PlaybackOutput.ts'

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
