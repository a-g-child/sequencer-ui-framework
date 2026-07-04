import type { PlaybackEvent } from './events'

export interface PlaybackOutput {
  handleEvent(event: PlaybackEvent): void
}

export class ConsoleMidiOutput implements PlaybackOutput {
  handleEvent(event: PlaybackEvent): void {
    if (event.type !== 'note:on' && event.type !== 'note:off') return

    console.info('[playback:midi]', {
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
