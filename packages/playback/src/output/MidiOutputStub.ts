import type { PlaybackEvent } from '../events'
import { noteOnlyCapabilities } from './OutputEvent'
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
      if (event.type === 'note:on') {
        this.port.send(
          [0x90 + (event.channel ?? 0), event.pitch, velocityToMidi(event.velocity)],
          event.timeMs
        )
      }

      if (event.type === 'note:off') {
        this.port.send([0x80 + (event.channel ?? 0), event.pitch, 0], event.timeMs)
      }

      if (event.type === 'automation:set') {
        const message = automationToMidi(event.parameterKey, event.value, event.channel ?? 0)

        if (message) {
          this.port.send(message, event.timeMs)
        }
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

function automationToMidi(
  parameterKey: string | undefined,
  value: number,
  channel: number
): readonly number[] | undefined {
  if (parameterKey === 'track.volume') {
    return [0xb0 + channel, 7, unitToMidi(value)]
  }

  if (parameterKey === 'track.pan') {
    return [0xb0 + channel, 10, bipolarToMidi(value)]
  }

  return undefined
}

function unitToMidi(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.round(Math.min(1, Math.max(0, value)) * 127)
}

function bipolarToMidi(value: number): number {
  if (!Number.isFinite(value)) return 64

  return Math.round(((Math.min(1, Math.max(-1, value)) + 1) / 2) * 127)
}
