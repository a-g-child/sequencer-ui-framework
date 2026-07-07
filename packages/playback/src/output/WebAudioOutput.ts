import type { VoiceAction } from '@sequencer/audio'
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

export interface WebAudioFilterSettings {
  readonly cutoff: number
  readonly resonance: number
  readonly keyTracking: number
}

export interface WebAudioOscillatorSettings {
  readonly enabled: boolean
  readonly waveform: WebAudioWaveform
  readonly volume: number
  readonly adsr: WebAudioAdsrSettings
  readonly filter: WebAudioFilterSettings
}

export type WebAudioOscillatorSettingsUpdate = Partial<
  Omit<WebAudioOscillatorSettings, 'adsr' | 'filter'>
> & {
  readonly adsr?: Partial<WebAudioAdsrSettings>
  readonly filter?: Partial<WebAudioFilterSettings>
}

export interface WebAudioOutputOptions {
  readonly enabled?: boolean
  readonly waveform?: WebAudioWaveform
  readonly volume?: number
  readonly adsr?: Partial<WebAudioAdsrSettings>
  readonly filter?: Partial<WebAudioFilterSettings>
}

type ActiveVoice = {
  readonly oscillator: OscillatorNode
  readonly filter: BiquadFilterNode
  readonly gain: GainNode
  readonly envelope?: VoiceActionEnvelope
  readonly trackId?: string
  readonly startTime: number
  readonly pitch: number
  readonly velocity: number
  readonly amplitude: number
  stopScheduled?: boolean
}

type VoiceActionEnvelope = Extract<
  VoiceAction,
  { type: 'voice:start' }
>['envelope']

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
      adsr: normalizeAdsr(options.adsr),
      filter: normalizeFilter(options.filter)
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
    this.panic()

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
        voice.amplitude *
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
          : normalizeAdsr({ ...currentSettings.adsr, ...settings.adsr }),
      filter:
        settings.filter === undefined
          ? currentSettings.filter
          : normalizeFilter({ ...currentSettings.filter, ...settings.filter })
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
    void events
  }

  handleVoiceActions(actions: readonly VoiceAction[]): void {
    if (!this.context || !this.masterGain) return

    for (const action of actions) {
      if (action.type === 'voice:start') {
        this.startVoice(action)
      }

      if (action.type === 'voice:release') {
        this.stopVoice(action.voiceId, action.timeMs)
      }

      if (action.type === 'voice:steal') {
        this.stopVoice(action.voiceId, action.timeMs)
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
      this.forceStopVoice(key, voice, stopTime)
    }
  }

  panicTrack(trackId: string): void {
    if (!this.context) {
      for (const [key, voice] of this.voices.entries()) {
        if (voice.trackId === trackId) {
          this.voices.delete(key)
        }
      }
      return
    }

    const stopTime = this.context.currentTime

    for (const [key, voice] of this.voices.entries()) {
      if (voice.trackId !== trackId) continue

      this.forceStopVoice(key, voice, stopTime)
    }
  }

  private startVoice(
    action: Extract<VoiceAction, { type: 'voice:start' }>
  ): void {
    if (!this.context || !this.masterGain) return

    const key = action.voiceId
    const settings = this.settingsForTrack(action.trackId)

    if (!settings.enabled) return

    const existingVoice = this.voices.get(key)
    if (existingVoice) {
      this.forceStopVoice(key, existingVoice, this.context.currentTime)
    }

    const oscillator = this.context.createOscillator()
    const filter = this.context.createBiquadFilter()
    const gain = this.context.createGain()
    const startTime = this.outputTime(action.timeMs)
    const envelope = normalizeVoiceEnvelope(action.envelope)
    const attackTime = startTime + envelope.attack
    const decayTime = attackTime + envelope.decay
    const amplitude = clampUnit(action.amplitude ?? action.velocity)
    const peakGain = amplitude * settings.volume
    const sustainGain = peakGain * envelope.sustain

    oscillator.type = settings.waveform
    configureOscillatorFrequency(oscillator, action, startTime)
    configureFilter(filter, settings.filter, action.pitch, startTime, true)
    gain.gain.cancelScheduledValues(startTime)
    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(peakGain, attackTime)
    gain.gain.linearRampToValueAtTime(sustainGain, decayTime)

    oscillator.connect(filter)
    filter.connect(gain)
    gain.connect(this.masterGain)
    oscillator.start(startTime)
    this.voices.set(key, {
      oscillator,
      filter,
      gain,
      envelope,
      trackId: action.trackId,
      startTime,
      pitch: action.pitch,
      velocity: clampUnit(action.velocity),
      amplitude
    })
  }

  private stopVoice(voiceKey: string, timeMs: number): void {
    const voice = this.voices.get(voiceKey)

    if (!voice || !this.context) return
    if (voice.stopScheduled) return

    const stopStart = this.outputTime(timeMs)
    const release = voice.envelope?.release ?? 0.2
    const stopTime = stopStart + release

    voice.gain.gain.cancelScheduledValues(stopStart)
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, stopStart)
    voice.gain.gain.linearRampToValueAtTime(0, stopTime)
    voice.oscillator.onended = () => {
      if (this.voices.get(voiceKey) === voice) {
        this.voices.delete(voiceKey)
      }
    }
    voice.stopScheduled = true
    voice.oscillator.stop(stopTime + 0.02)
  }

  private forceStopVoice(
    voiceKey: string,
    voice: ActiveVoice,
    stopTime: number
  ): void {
    const safeStopTime = Math.max(stopTime, voice.startTime) + 0.001

    voice.gain.gain.cancelScheduledValues(stopTime)
    voice.gain.gain.setValueAtTime(0, stopTime)
    try {
      voice.gain.disconnect()
    } catch {
      // Already disconnected voices are safe to ignore during panic cleanup.
    }
    if (!voice.stopScheduled) {
      voice.stopScheduled = true
      try {
        voice.oscillator.stop(safeStopTime)
      } catch {
        try {
          voice.oscillator.stop()
        } catch {
          // Already stopped voices are safe to ignore during panic cleanup.
        }
      }
    }
    this.voices.delete(voiceKey)
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
      configureFilter(
        voice.filter,
        settings.filter,
        voice.pitch,
        this.context.currentTime
      )
      voice.gain.gain.setTargetAtTime(
        voice.amplitude * settings.volume * settings.adsr.sustain,
        this.context.currentTime,
        0.01
      )
    }
  }
}

function midiNoteToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

function configureOscillatorFrequency(
  oscillator: OscillatorNode,
  action: Extract<VoiceAction, { type: 'voice:start' }>,
  startTime: number
): void {
  const targetFrequency = midiNoteToFrequency(action.pitch)
  const glideTime = Math.max(0, action.glide?.time ?? 0)

  if (!action.glide || glideTime <= 0) {
    oscillator.frequency.setValueAtTime(targetFrequency, startTime)
    return
  }

  const startFrequency = midiNoteToFrequency(action.glide.startPitch)

  oscillator.frequency.setValueAtTime(startFrequency, startTime)
  oscillator.frequency.exponentialRampToValueAtTime(
    targetFrequency,
    startTime + glideTime
  )
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

function normalizeFilter(
  filter: Partial<WebAudioFilterSettings> | undefined = {}
): WebAudioFilterSettings {
  return {
    cutoff: clampFrequency(filter.cutoff ?? 20000),
    resonance: clampResonance(filter.resonance ?? 0),
    keyTracking: clampUnit(filter.keyTracking ?? 0)
  }
}

function normalizeVoiceEnvelope(
  envelope: VoiceActionEnvelope | undefined
): NonNullable<VoiceActionEnvelope> {
  return {
    attack: clampSeconds(envelope?.attack ?? 0.01, 5),
    decay: clampSeconds(envelope?.decay ?? 0.15, 5),
    sustain: clampUnit(envelope?.sustain ?? 0.7),
    release: clampSeconds(envelope?.release ?? 0.2, 10)
  }
}

function clampMs(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(5000, Math.max(0, value))
}

function clampSeconds(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(max, Math.max(0, value))
}

function clampFrequency(value: number): number {
  if (!Number.isFinite(value)) return 20000

  return Math.min(20000, Math.max(20, value))
}

function clampResonance(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(20, Math.max(0, value))
}

function configureFilter(
  filter: BiquadFilterNode,
  settings: WebAudioFilterSettings,
  pitch: number,
  time: number,
  immediate = false
): void {
  filter.type = 'lowpass'
  const cutoff = effectiveCutoff(settings, pitch)

  if (immediate) {
    filter.frequency.setValueAtTime(cutoff, time)
    filter.Q.setValueAtTime(settings.resonance, time)
    return
  }

  filter.frequency.setTargetAtTime(cutoff, time, 0.01)
  filter.Q.setTargetAtTime(settings.resonance, time, 0.01)
}

function effectiveCutoff(
  settings: WebAudioFilterSettings,
  pitch: number
): number {
  const trackingRatio = 2 ** (((pitch - 60) / 12) * settings.keyTracking)

  return clampFrequency(settings.cutoff * trackingRatio)
}

function performanceNow(): number {
  return globalThis.performance?.now() ?? Date.now()
}

declare global {
  var webkitAudioContext: typeof AudioContext | undefined
}
