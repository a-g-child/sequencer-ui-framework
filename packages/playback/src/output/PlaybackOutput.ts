import type { PlaybackEvent } from '../events.ts'
import type { OutputCapabilities } from './OutputEvent.ts'

export interface PlaybackOutput {
  readonly id: string
  readonly name: string
  readonly capabilities?: OutputCapabilities

  connect(): Promise<void>
  disconnect(): Promise<void>
  handleEvents(events: PlaybackEvent[]): void
  panic?(): void
  panicTrack?(trackId: string): void
}
