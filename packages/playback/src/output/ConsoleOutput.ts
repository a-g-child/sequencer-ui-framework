import type { PlaybackEvent } from '../events'
import { noteOnlyCapabilities } from './OutputEvent'
import type { PlaybackOutput } from './PlaybackOutput'

export class ConsoleOutput implements PlaybackOutput {
  readonly id = 'console'
  readonly name = 'Console Output'
  readonly capabilities = noteOnlyCapabilities

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  handleEvents(events: PlaybackEvent[]): void {
    for (const event of events) {
      if (event.type !== 'note:on' && event.type !== 'note:off') continue

      console.info('[playback:event]', {
        type: event.type,
        pitch: event.pitch,
        velocity: event.velocity,
        channel: event.channel,
        trackId: event.trackId,
        beat: event.beat,
        timeMs: event.timeMs
      })
    }
  }
}
