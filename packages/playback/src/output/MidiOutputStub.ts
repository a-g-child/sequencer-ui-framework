import type { PlaybackEvent } from '../events'
import { midiMessagesForPlaybackEvent } from './MidiMessages.ts'
import { noteOnlyCapabilities } from './OutputEvent.ts'
import type { PlaybackOutput } from './PlaybackOutput'

export interface MidiOutputPort {
  send(message: readonly number[], timeMs?: number): void
}

export class MidiOutputStub implements PlaybackOutput {
  readonly id = 'midi-stub'
  readonly name = 'MIDI Output Stub'
  readonly capabilities = {
    ...noteOnlyCapabilities,
    controlEvents: true,
    automation: true
  }

  constructor(private readonly port: MidiOutputPort = new ConsoleMidiPort()) {}

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  handleEvents(events: PlaybackEvent[]): void {
    for (const event of events) {
      for (const message of midiMessagesForPlaybackEvent(event)) {
        this.port.send(message, event.timeMs)
      }
    }
  }
}

class ConsoleMidiPort implements MidiOutputPort {
  send(message: readonly number[], timeMs?: number): void {
    console.info('[playback:midi-stub]', { message, timeMs })
  }
}
