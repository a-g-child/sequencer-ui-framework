import type { PlaybackEvent } from '../events'
import { noteOnlyCapabilities } from './OutputEvent'
import type { PlaybackOutput } from './PlaybackOutput'

export type WebAudioWaveform = OscillatorType

export interface WebAudioOutputOptions {
  readonly waveform?: WebAudioWaveform
  readonly volume?: number
  readonly releaseMs?: number
}

type ActiveVoice = {
  readonly oscillator: OscillatorNode
  readonly gain: GainNode
}

export class WebAudioOutput implements PlaybackOutput {
  readonly id = 'web-audio'
  readonly name = 'Web Audio Output'
  readonly capabilities = noteOnlyCapabilities

  private context?: AudioContext
  private masterGain?: GainNode
  private waveform: WebAudioWaveform
  private volume: number
  private readonly releaseMs: number
  private readonly voices = new Map<string, ActiveVoice>()

  constructor(options: WebAudioOutputOptions = {}) {
    this.waveform = options.waveform ?? 'sine'
    this.volume = clampUnit(options.volume ?? 0.2)
    this.releaseMs = Math.max(5, options.releaseMs ?? 60)
  }

  async connect(): Promise<void> {
    const AudioContextConstructor =
      globalThis.AudioContext ?? globalThis.webkitAudioContext

    if (!AudioContextConstructor) {
      throw new Error('Web Audio is not available in this environment')
    }

    if (!this.context) {
      this.context = new AudioContextConstructor()
      this.masterGain = this.context.createGain()
      this.masterGain.gain.value = this.volume
      this.masterGain.connect(this.context.destination)
    }

    if (this.context.state === 'suspended') {
      await this.context.resume()
    }
  }

  async disconnect(): Promise<void> {
    for (const voiceKey of [...this.voices.keys()]) {
      this.stopVoice(voiceKey, 0)
    }

    this.voices.clear()

    if (this.context && this.context.state !== 'closed') {
      await this.context.close()
    }

    this.context = undefined
    this.masterGain = undefined
  }

  setWaveform(waveform: WebAudioWaveform): void {
    this.waveform = waveform

    for (const voice of this.voices.values()) {
      voice.oscillator.type = waveform
    }
  }

  setVolume(volume: number): void {
    this.volume = clampUnit(volume)

    if (this.context && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.01
      )
    }
  }

  handleEvents(events: PlaybackEvent[]): void {
    if (!this.context || !this.masterGain) return

    for (const event of events) {
      if (event.type === 'note:on') {
        this.startVoice(event)
      }

      if (event.type === 'note:off') {
        this.stopVoice(voiceKey(event), event.timeMs)
      }
    }
  }

  private startVoice(event: Extract<PlaybackEvent, { type: 'note:on' }>): void {
    if (!this.context || !this.masterGain) return

    const key = voiceKey(event)

    this.stopVoice(key, event.timeMs)

    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    const startTime = this.outputTime(event.timeMs)

    oscillator.type = this.waveform
    oscillator.frequency.value = midiNoteToFrequency(event.pitch)
    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(
      clampUnit(event.velocity),
      startTime + 0.005
    )

    oscillator.connect(gain)
    gain.connect(this.masterGain)
    oscillator.start(startTime)
    this.voices.set(key, { oscillator, gain })
  }

  private stopVoice(voiceKey: string, timeMs: number): void {
    const voice = this.voices.get(voiceKey)

    if (!voice || !this.context) return

    const stopStart = this.outputTime(timeMs)
    const stopTime = stopStart + this.releaseMs / 1000

    voice.gain.gain.cancelScheduledValues(stopStart)
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, stopStart)
    voice.gain.gain.linearRampToValueAtTime(0, stopTime)
    voice.oscillator.stop(stopTime)
    this.voices.delete(voiceKey)
  }

  private outputTime(timeMs: number): number {
    if (!this.context) return 0

    const now = performanceNow()
    const deltaSeconds = Math.max(0, timeMs - now) / 1000

    return this.context.currentTime + deltaSeconds
  }
}

function voiceKey(
  event: Extract<PlaybackEvent, { type: 'note:on' | 'note:off' }>
): string {
  return `${event.trackId ?? 'track'}:${event.noteId}:${event.pitch}`
}

function midiNoteToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(1, Math.max(0, value))
}

function performanceNow(): number {
  return globalThis.performance?.now() ?? Date.now()
}

declare global {
  var webkitAudioContext: typeof AudioContext | undefined
}
