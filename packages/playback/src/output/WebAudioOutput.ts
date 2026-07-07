import type { PlaybackEvent } from '../events'
import { noteOnlyCapabilities } from './OutputEvent'
import type { PlaybackOutput } from './PlaybackOutput'

export type WebAudioWaveform = OscillatorType

export interface WebAudioAdsrSettings {
  readonly attackMs: number
  readonly decayMs: number
  readonly sustain: number
  readonly releaseMs: number
}

export interface WebAudioOscillatorSettings {
  readonly enabled: boolean
  readonly waveform: WebAudioWaveform
  readonly volume: number
  readonly adsr: WebAudioAdsrSettings
}

export type WebAudioOscillatorSettingsUpdate = Partial<
  Omit<WebAudioOscillatorSettings, 'adsr'>
> & {
  readonly adsr?: Partial<WebAudioAdsrSettings>
}

export interface WebAudioOutputOptions {
  readonly enabled?: boolean
  readonly waveform?: WebAudioWaveform
  readonly volume?: number
  readonly adsr?: Partial<WebAudioAdsrSettings>
}

type ActiveVoice = {
  readonly oscillator: OscillatorNode
  readonly gain: GainNode
  readonly trackId?: string
  readonly velocity: number
  stopScheduled?: boolean
}

export class WebAudioOutput implements PlaybackOutput {
  readonly id = 'web-audio'
  readonly name = 'Web Audio Output'
  readonly capabilities = noteOnlyCapabilities

  private context?: AudioContext
  private masterGain?: GainNode
  private defaultSettings: WebAudioOscillatorSettings
  private readonly trackSettings = new Map<string, WebAudioOscillatorSettings>()
  private readonly voices = new Map<string, ActiveVoice>()

  constructor(options: WebAudioOutputOptions = {}) {
    this.defaultSettings = {
      enabled: options.enabled ?? false,
      waveform: options.waveform ?? 'sine',
      volume: clampUnit(options.volume ?? 0.2),
      adsr: normalizeAdsr(options.adsr)
    }
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
      this.masterGain.gain.value = 1
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
    this.defaultSettings = {
      ...this.defaultSettings,
      waveform
    }

    for (const voice of this.voices.values()) {
      if (voice.trackId && this.trackSettings.has(voice.trackId)) continue

      voice.oscillator.type = waveform
    }
  }

  setVolume(volume: number): void {
    this.defaultSettings = {
      ...this.defaultSettings,
      volume: clampUnit(volume)
    }

    if (!this.context) return

    for (const voice of this.voices.values()) {
      if (voice.trackId && this.trackSettings.has(voice.trackId)) continue

      voice.gain.gain.setTargetAtTime(
        voice.velocity *
          this.defaultSettings.volume *
          this.defaultSettings.adsr.sustain,
        this.context.currentTime,
        0.01
      )
    }
  }

  setTrackSettings(
    trackId: string,
    settings: WebAudioOscillatorSettingsUpdate
  ): void {
    const currentSettings = this.settingsForTrack(trackId)
    const nextSettings: WebAudioOscillatorSettings = {
      ...currentSettings,
      ...settings,
      volume:
        settings.volume === undefined
          ? currentSettings.volume
          : clampUnit(settings.volume),
      adsr:
        settings.adsr === undefined
          ? currentSettings.adsr
          : normalizeAdsr({ ...currentSettings.adsr, ...settings.adsr })
    }

    this.trackSettings.set(trackId, nextSettings)
    this.updateActiveTrackVoices(trackId, nextSettings)
  }

  trackSettingsFor(trackId: string | undefined): WebAudioOscillatorSettings {
    return trackId ? this.settingsForTrack(trackId) : this.defaultSettings
  }

  get settings(): {
    readonly defaultSettings: WebAudioOscillatorSettings
    readonly trackSettings: Readonly<Record<string, WebAudioOscillatorSettings>>
  } {
    return {
      defaultSettings: this.defaultSettings,
      trackSettings: Object.fromEntries(this.trackSettings.entries())
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

  panic(): void {
    if (!this.context) {
      this.voices.clear()
      return
    }

    const stopTime = this.context.currentTime

    for (const [key, voice] of this.voices.entries()) {
      voice.gain.gain.cancelScheduledValues(stopTime)
      voice.gain.gain.setValueAtTime(0, stopTime)
      if (!voice.stopScheduled) {
        voice.stopScheduled = true
        voice.oscillator.stop(stopTime)
      }
      this.voices.delete(key)
    }
  }

  private startVoice(event: Extract<PlaybackEvent, { type: 'note:on' }>): void {
    if (!this.context || !this.masterGain) return

    const key = voiceKey(event)
    const settings = this.settingsForTrack(event.trackId)

    if (!settings.enabled) return

    this.stopVoice(key, event.timeMs)

    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    const startTime = this.outputTime(event.timeMs)
    const attackTime = startTime + settings.adsr.attackMs / 1000
    const decayTime = attackTime + settings.adsr.decayMs / 1000
    const peakGain = clampUnit(event.velocity) * settings.volume
    const sustainGain = peakGain * settings.adsr.sustain

    oscillator.type = settings.waveform
    oscillator.frequency.value = midiNoteToFrequency(event.pitch)
    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(peakGain, attackTime)
    gain.gain.linearRampToValueAtTime(sustainGain, decayTime)

    oscillator.connect(gain)
    gain.connect(this.masterGain)
    oscillator.start(startTime)
    this.voices.set(key, {
      oscillator,
      gain,
      trackId: event.trackId,
      velocity: clampUnit(event.velocity)
    })
  }

  private stopVoice(voiceKey: string, timeMs: number): void {
    const voice = this.voices.get(voiceKey)

    if (!voice || !this.context) return
    if (voice.stopScheduled) return

    const stopStart = this.outputTime(timeMs)
    const settings = this.settingsForTrack(voice.trackId)
    const stopTime = stopStart + settings.adsr.releaseMs / 1000

    voice.gain.gain.cancelScheduledValues(stopStart)
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, stopStart)
    voice.gain.gain.linearRampToValueAtTime(0, stopTime)
    voice.oscillator.onended = () => {
      if (this.voices.get(voiceKey) === voice) {
        this.voices.delete(voiceKey)
      }
    }
    voice.stopScheduled = true
    voice.oscillator.stop(stopTime)
  }

  private outputTime(timeMs: number): number {
    if (!this.context) return 0

    const now = performanceNow()
    const deltaSeconds = Math.max(0, timeMs - now) / 1000

    return this.context.currentTime + deltaSeconds
  }

  private settingsForTrack(trackId: string | undefined): WebAudioOscillatorSettings {
    if (!trackId) return this.defaultSettings

    return this.trackSettings.get(trackId) ?? this.defaultSettings
  }

  private updateActiveTrackVoices(
    trackId: string,
    settings: WebAudioOscillatorSettings
  ): void {
    if (!this.context) return

    for (const [key, voice] of this.voices.entries()) {
      if (voice.trackId !== trackId) continue

      if (!settings.enabled) {
        this.stopVoice(key, performanceNow())
        continue
      }

      voice.oscillator.type = settings.waveform
      voice.gain.gain.setTargetAtTime(
        voice.velocity * settings.volume * settings.adsr.sustain,
        this.context.currentTime,
        0.01
      )
    }
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

function normalizeAdsr(
  adsr: Partial<WebAudioAdsrSettings> | undefined = {}
): WebAudioAdsrSettings {
  return {
    attackMs: clampMs(adsr.attackMs ?? 5),
    decayMs: clampMs(adsr.decayMs ?? 60),
    sustain: clampUnit(adsr.sustain ?? 0.8),
    releaseMs: clampMs(adsr.releaseMs ?? 80)
  }
}

function clampMs(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(5000, Math.max(0, value))
}

function performanceNow(): number {
  return globalThis.performance?.now() ?? Date.now()
}

declare global {
  var webkitAudioContext: typeof AudioContext | undefined
}
