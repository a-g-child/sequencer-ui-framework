import type { PlaybackEvent } from '../events.ts'
import { observationCapabilities } from './OutputEvent.ts'
import type { PlaybackOutput } from './PlaybackOutput.ts'

export class ConsoleOutput implements PlaybackOutput {
  readonly id = 'console'
  readonly name = 'Console Output'
  readonly capabilities = observationCapabilities

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  handleEvents(events: PlaybackEvent[]): void {
    for (const event of events) {
      if (event.type === 'automation:set') {
        console.info('[playback:event]', {
          type: event.type,
          parameterId: event.parameterId,
          parameterKey: event.parameterKey,
          value: event.value,
          channel: event.channel,
          trackId: event.trackId,
          beat: event.beat,
          timeMs: event.timeMs
        })
        continue
      }

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
