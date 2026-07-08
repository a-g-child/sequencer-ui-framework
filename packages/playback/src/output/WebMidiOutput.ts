import type { PlaybackEvent } from '../events'
import { midiMessagesForPlaybackEvent } from './MidiMessages.ts'
import { noteOnlyCapabilities } from './OutputEvent.ts'
import type { PlaybackOutput } from './PlaybackOutput'

type MidiOutputPort = {
  readonly id: string
  readonly name?: string | null
  send(data: number[] | Uint8Array, timestamp?: number): void
}

type MidiAccess = {
  readonly outputs: {
    values(): IterableIterator<MidiOutputPort>
  }
}

type NavigatorWithMidi = Navigator & {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MidiAccess>
}

export interface WebMidiOutputStatus {
  readonly available: boolean
  readonly connected: boolean
  readonly outputId?: string
  readonly outputName?: string
  readonly lastError?: string
  readonly sentMessageCount: number
}

export class WebMidiOutput implements PlaybackOutput {
  readonly id = 'web-midi'
  readonly name = 'Web MIDI'
  readonly capabilities = {
    ...noteOnlyCapabilities,
    controlEvents: true,
    automation: true
  }

  private access?: MidiAccess
  private output?: MidiOutputPort
  private available = false
  private connected = false
  private lastError: string | undefined
  private sentMessageCount = 0

  get status(): WebMidiOutputStatus {
    return {
      available: this.available,
      connected: this.connected,
      outputId: this.output?.id,
      outputName: this.output?.name ?? undefined,
      lastError: this.lastError,
      sentMessageCount: this.sentMessageCount
    }
  }

  async connect(): Promise<void> {
    const requestMIDIAccess = (globalThis.navigator as NavigatorWithMidi | undefined)
      ?.requestMIDIAccess

    if (!requestMIDIAccess) {
      this.available = false
      this.connected = false
      this.lastError = 'Web MIDI is not available in this environment'
      return
    }

    try {
      this.access = await requestMIDIAccess.call(globalThis.navigator)
      this.output = this.firstOutput(this.access)
      this.available = true
      this.connected = Boolean(this.output)
      this.lastError = this.output ? undefined : 'No Web MIDI outputs available'
    } catch (error) {
      this.available = false
      this.connected = false
      this.output = undefined
      this.lastError = error instanceof Error
        ? error.message
        : 'Could not initialise Web MIDI'
    }
  }

  async disconnect(): Promise<void> {
    this.panic()
    this.connected = false
    this.output = undefined
    this.access = undefined
  }

  handleEvents(events: PlaybackEvent[]): void {
    if (!this.output) return

    for (const event of events) {
      for (const message of midiMessagesForPlaybackEvent(event)) {
        this.output.send(message, event.timeMs)
        this.sentMessageCount += 1
      }
    }
  }

  panic(): void {
    if (!this.output) return

    for (let channel = 0; channel < 16; channel += 1) {
      this.output.send([0xb0 + channel, 123, 0])
      this.output.send([0xb0 + channel, 120, 0])
      this.sentMessageCount += 2
    }
  }

  private firstOutput(access: MidiAccess): MidiOutputPort | undefined {
    return access.outputs.values().next().value
  }
}
