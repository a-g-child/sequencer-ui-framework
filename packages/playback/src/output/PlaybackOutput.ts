import type { PlaybackEvent } from '../events'
import type { OutputCapabilities } from './OutputEvent'

export interface PlaybackOutput {
  readonly id: string
  readonly name: string
  readonly capabilities?: OutputCapabilities

  connect(): Promise<void>
  disconnect(): Promise<void>
  handleEvents(events: PlaybackEvent[]): void
}
