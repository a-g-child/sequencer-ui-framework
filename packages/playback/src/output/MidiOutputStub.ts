import type { PlaybackEvent } from '../events'
import { noteOnlyCapabilities } from './OutputEvent'
import type { PlaybackOutput } from './PlaybackOutput'

export interface MidiOutputPort {
  send(message: readonly number[], timeMs?: number): void
}

export class MidiOutputStub implements PlaybackOutput {
  readonly id = 'midi-stub'
  readonly name = 'MIDI Output Stub'
  readonly capabilities = noteOnlyCapabilities

  constructor(private readonly port: MidiOutputPort = new ConsoleMidiPort()) {}

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  handleEvents(events: PlaybackEvent[]): void {
    for (const event of events) {
      if (event.type === 'note:on') {
        this.port.send(
          [0x90 + (event.channel ?? 0), event.pitch, velocityToMidi(event.velocity)],
          event.timeMs
        )
      }

      if (event.type === 'note:off') {
        this.port.send([0x80 + (event.channel ?? 0), event.pitch, 0], event.timeMs)
      }
    }
  }
}

class ConsoleMidiPort implements MidiOutputPort {
  send(message: readonly number[], timeMs?: number): void {
    console.info('[playback:midi-stub]', { message, timeMs })
  }
}

function velocityToMidi(velocity: number): number {
  if (!Number.isFinite(velocity)) return 0

  return Math.round(Math.min(1, Math.max(0, velocity)) * 127)
}
