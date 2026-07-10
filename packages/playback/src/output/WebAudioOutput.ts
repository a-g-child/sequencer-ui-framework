import type { AssetReference } from '@sequencer/assets'
import type { SampleVoiceAction, VoiceAction } from '@sequencer/audio'
import {
  AudioGraphBuilder,
  BASIC_SYNTH_AUDIO_GRAPH,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  DELAY_AUDIO_GRAPH,
  SAMPLER_AUDIO_GRAPH
} from '@sequencer/audio-graph'
import type { TrackMixerState } from '@sequencer/core'
import type { PlaybackEvent } from '../events'
import { noteOnlyCapabilities } from './OutputEvent'
import type { PlaybackOutput } from './PlaybackOutput'
import { WebAudioAssetLoader } from './WebAudioAssetLoader'
import {
  WebAudioExecutor,
  type WebAudioDelayNodeChain
} from './WebAudioExecutor'

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

export interface WebAudioDelaySettings {
  readonly time: number
  readonly feedback: number
  readonly mix: number
}

type ActiveVoice = {
  readonly oscillator: OscillatorNode
  readonly filter: BiquadFilterNode
  readonly gain: GainNode
  readonly trackGain: GainNode
  readonly mixerGain: GainNode
  readonly panner: StereoPannerNode
  readonly envelope?: VoiceActionEnvelope
  readonly trackId?: string
  readonly startTime: number
  readonly pitch: number
  readonly velocity: number
  readonly amplitude: number
  stopScheduled?: boolean
}

type ActiveSample = {
  readonly source: AudioBufferSourceNode
  readonly gain: GainNode
  readonly trackGain: GainNode
  readonly mixerGain: GainNode
  readonly panner: StereoPannerNode
  readonly trackId?: string
  readonly startTime: number
  stopScheduled?: boolean
}

type ActiveDelayEffect = {
  readonly chain: WebAudioDelayNodeChain
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
  private readonly trackMixers = new Map<string, TrackMixerState>()
  private readonly voices = new Map<string, ActiveVoice>()
  private readonly samples = new Map<string, ActiveSample>()
  private readonly sampleBuffers = new Map<string, AudioBuffer>()
  private readonly executor = new WebAudioExecutor()
  private readonly samplerExecutor = new WebAudioExecutor()
  private readonly delayExecutor = new WebAudioExecutor()
  private readonly delayEffects = new Map<string, ActiveDelayEffect>()
  private readonly basicSynthRuntimeGraph = new AudioGraphBuilder(
    DEFAULT_AUDIO_NODE_DESCRIPTORS
  ).build(BASIC_SYNTH_AUDIO_GRAPH)
  private readonly samplerRuntimeGraph = new AudioGraphBuilder(
    DEFAULT_AUDIO_NODE_DESCRIPTORS
  ).build(SAMPLER_AUDIO_GRAPH)
  private readonly delayRuntimeGraph = new AudioGraphBuilder(
    DEFAULT_AUDIO_NODE_DESCRIPTORS
  ).build(DELAY_AUDIO_GRAPH)

  constructor(options: WebAudioOutputOptions = {}) {
    this.defaultSettings = {
      enabled: options.enabled ?? true,
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

    if (this.executor.status === 'idle' || this.executor.status === 'shutdown') {
      await this.executor.initialise(this.basicSynthRuntimeGraph)
    }

    if (
      this.samplerExecutor.status === 'idle' ||
      this.samplerExecutor.status === 'shutdown'
    ) {
      await this.samplerExecutor.initialise(this.samplerRuntimeGraph)
    }

    if (
      this.delayExecutor.status === 'idle' ||
      this.delayExecutor.status === 'shutdown'
    ) {
      await this.delayExecutor.initialise(this.delayRuntimeGraph)
    }
  }

  async disconnect(): Promise<void> {
    this.panic()

    if (this.context && this.context.state !== 'closed') {
      await this.context.close()
    }

    this.context = undefined
    this.masterGain = undefined
    this.executor.shutdown()
    this.samplerExecutor.shutdown()
    this.delayExecutor.shutdown()
    this.delayEffects.clear()
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

      voice.trackGain.gain.setTargetAtTime(
        this.defaultSettings.volume,
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

    if (settingsEqual(currentSettings, nextSettings)) return

    this.trackSettings.set(trackId, nextSettings)
    this.updateActiveTrackVoices(trackId, currentSettings, nextSettings)
  }

  setTrackMixers(mixers: Readonly<Record<string, TrackMixerState>>): void {
    this.trackMixers.clear()

    for (const [trackId, mixer] of Object.entries(mixers)) {
      this.trackMixers.set(trackId, normalizeTrackMixer(mixer))
    }

    this.updateActiveMixerNodes()
  }

  setTrackDelaySettings(
    trackId: string,
    settings: WebAudioDelaySettings | undefined
  ): void {
    if (!this.context || !this.masterGain) return

    if (!settings) {
      this.removeTrackDelayEffect(trackId)
      return
    }

    const existingEffect = this.delayEffects.get(trackId)
    const time = this.context.currentTime

    if (existingEffect) {
      this.delayExecutor.updateDelayNode(existingEffect.chain, {
        delayTime: settings.time,
        feedback: settings.feedback,
        mix: settings.mix,
        time
      })
      return
    }

    const chain = this.delayExecutor.materialiseDelayNode(this.context, {
      delayTime: settings.time,
      feedback: settings.feedback,
      mix: settings.mix,
      time,
      immediate: true
    })

    this.delayExecutor.connectAudioOutputNode(chain.output, this.masterGain)
    this.delayEffects.set(trackId, { chain })
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

  handleSampleActions(actions: readonly SampleVoiceAction[]): void {
    if (!this.context || !this.masterGain) return

    for (const action of actions) {
      if (action.type === 'sample:start') {
        this.startSample(action)
      }

      if (action.type === 'sample:release') {
        this.stopSample(action.voiceId, action.timeMs)
      }
    }
  }

  async loadSampleAsset(asset: AssetReference): Promise<AudioBuffer> {
    await this.connect()

    if (!this.context) {
      throw new Error('Web Audio context is not available')
    }

    const loader = new WebAudioAssetLoader(this.context)
    const buffer = await loader.load(asset)
    this.sampleBuffers.set(asset.id, buffer)
    return buffer
  }

  panic(): void {
    if (!this.context) {
      this.voices.clear()
      this.samples.clear()
      return
    }

    const stopTime = this.context.currentTime

    for (const [key, voice] of this.voices.entries()) {
      this.forceStopVoice(key, voice, stopTime)
    }

    for (const [key, sample] of this.samples.entries()) {
      this.forceStopSample(key, sample, stopTime)
    }
  }

  panicTrack(trackId: string): void {
    if (!this.context) {
      for (const [key, voice] of this.voices.entries()) {
        if (voice.trackId === trackId) {
          this.voices.delete(key)
        }
      }
      for (const [key, sample] of this.samples.entries()) {
        if (sample.trackId === trackId) {
          this.samples.delete(key)
        }
      }
      return
    }

    const stopTime = this.context.currentTime

    for (const [key, voice] of this.voices.entries()) {
      if (voice.trackId !== trackId) continue

      this.forceStopVoice(key, voice, stopTime)
    }

    for (const [key, sample] of this.samples.entries()) {
      if (sample.trackId !== trackId) continue

      this.forceStopSample(key, sample, stopTime)
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

    const startTime = this.outputTime(action.timeMs)
    const oscillator = this.executor.materialiseOscillatorNode(this.context, {
      waveform: settings.waveform,
      pitch: action.pitch,
      glide: action.glide,
      startTime
    })
    const filter = this.executor.materialiseFilterNode(this.context, {
      ...settings.filter,
      pitch: action.pitch,
      time: startTime,
      immediate: true
    })
    const envelope = normalizeVoiceEnvelope(action.envelope)
    const attackTime = startTime + envelope.attack
    const decayTime = attackTime + envelope.decay
    const amplitude = clampUnit(action.amplitude ?? action.velocity)
    const peakGain = amplitude
    const sustainGain = peakGain * envelope.sustain
    const gain = this.executor.materialiseAdsrGainNode(this.context, {
      peakGain,
      sustainGain,
      startTime,
      attackTime,
      decayTime
    })
    const trackGain = this.executor.materialiseGainNode(this.context, {
      gain: settings.volume,
      time: startTime,
      immediate: true
    })
    const mixer = this.mixerForTrack(action.trackId)
    const mixerGainValue = effectiveMixerGain(mixer, this.anySoloedTrack())
    const panner = this.executor.materialisePanNode(this.context, {
      pan: mixer.pan,
      time: startTime,
      immediate: true
    })
    const mixerGain = this.executor.materialiseMixerNode(this.context, {
      gain: mixerGainValue,
      time: startTime,
      immediate: true
    })

    oscillator.connect(filter)
    filter.connect(gain)
    gain.connect(trackGain)
    trackGain.connect(panner)
    panner.connect(mixerGain)
    this.executor.connectAudioOutputNode(
      mixerGain,
      this.trackOutputNode(action.trackId)
    )
    oscillator.start(startTime)
    this.voices.set(key, {
      oscillator,
      filter,
      gain,
      trackGain,
      mixerGain,
      panner,
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

    this.executor.releaseAdsrGainNode(voice.gain, {
      startTime: stopStart,
      stopTime
    })
    voice.oscillator.onended = () => {
      if (this.voices.get(voiceKey) === voice) {
        this.voices.delete(voiceKey)
      }
    }
    voice.stopScheduled = true
    voice.oscillator.stop(stopTime + 0.02)
  }

  private startSample(
    action: Extract<SampleVoiceAction, { type: 'sample:start' }>
  ): void {
    if (!this.context || !this.masterGain) return

    const key = action.voiceId
    const settings = this.settingsForTrack(action.trackId)

    if (!settings.enabled) return

    const existingSample = this.samples.get(key)
    if (existingSample) {
      this.forceStopSample(key, existingSample, this.context.currentTime)
    }

    const buffer = this.bufferForSampleAction(action)
    const startTime = this.outputTime(action.timeMs)
    const offset = sampleOffsetSeconds(buffer, action)
    const duration = sampleDurationSeconds(buffer, action)
    const source = this.samplerExecutor.materialiseSamplePlayerNode(this.context, {
      buffer,
      playbackRate: action.playbackRate,
      loopEnabled: action.loopEnabled,
      loopStartSeconds: action.loopStartSeconds,
      loopEndSeconds: action.loopEndSeconds,
      startTime
    })
    const gain = this.samplerExecutor.materialiseAdsrGainNode(this.context, {
      peakGain: Math.max(0, action.gain),
      sustainGain: Math.max(0, action.gain),
      startTime,
      attackTime: startTime,
      decayTime: startTime
    })
    const trackGain = this.samplerExecutor.materialiseGainNode(this.context, {
      gain: 1,
      time: startTime,
      immediate: true
    })
    const mixer = this.mixerForTrack(action.trackId)
    const mixerGainValue = effectiveMixerGain(mixer, this.anySoloedTrack())
    const panner = this.samplerExecutor.materialisePanNode(this.context, {
      pan: mixer.pan,
      time: startTime,
      immediate: true
    })
    const mixerGain = this.samplerExecutor.materialiseMixerNode(this.context, {
      gain: mixerGainValue,
      time: startTime,
      immediate: true
    })

    source.connect(gain)
    gain.connect(trackGain)
    trackGain.connect(panner)
    panner.connect(mixerGain)
    this.samplerExecutor.connectAudioOutputNode(
      mixerGain,
      this.trackOutputNode(action.trackId)
    )
    source.onended = () => {
      if (this.samples.get(key)?.source === source) {
        this.samples.delete(key)
      }
    }

    this.samplerExecutor.triggerSamplePlayerNode(source, {
      startTime,
      offset,
      duration
    })

    this.samples.set(key, {
      source,
      gain,
      trackGain,
      mixerGain,
      panner,
      trackId: action.trackId,
      startTime
    })
  }

  private stopSample(sampleKey: string, timeMs: number): void {
    const sample = this.samples.get(sampleKey)

    if (!sample || !this.context) return
    if (sample.stopScheduled) return

    const stopStart = this.outputTime(timeMs)
    const stopTime = stopStart + 0.02

    this.samplerExecutor.releaseAdsrGainNode(sample.gain, {
      startTime: stopStart,
      stopTime
    })
    sample.source.onended = () => {
      if (this.samples.get(sampleKey) === sample) {
        this.samples.delete(sampleKey)
      }
    }
    sample.stopScheduled = true
    this.samplerExecutor.stopSamplePlayerNode(sample.source, {
      stopTime: stopTime + 0.01
    })
  }

  private forceStopVoice(
    voiceKey: string,
    voice: ActiveVoice,
    stopTime: number
  ): void {
    const safeStopTime = Math.max(stopTime, voice.startTime) + 0.001

    this.executor.clearAdsrGainNode(voice.gain, stopTime)
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

  private forceStopSample(
    sampleKey: string,
    sample: ActiveSample,
    stopTime: number
  ): void {
    const safeStopTime = Math.max(stopTime, sample.startTime) + 0.001

    this.samplerExecutor.clearAdsrGainNode(sample.gain, stopTime)
    try {
      sample.gain.disconnect()
    } catch {
      // Already disconnected samples are safe to ignore during panic cleanup.
    }
    if (!sample.stopScheduled) {
      sample.stopScheduled = true
      try {
        this.samplerExecutor.stopSamplePlayerNode(sample.source, {
          stopTime: safeStopTime
        })
      } catch {
        try {
          this.samplerExecutor.stopSamplePlayerNode(sample.source, {
            stopTime: this.context?.currentTime ?? 0
          })
        } catch {
          // Already stopped samples are safe to ignore during panic cleanup.
        }
      }
    }
    this.samples.delete(sampleKey)
  }

  private trackOutputNode(trackId: string | undefined): AudioNode {
    if (trackId) {
      const effect = this.delayEffects.get(trackId)

      if (effect) return effect.chain.input
    }

    if (!this.masterGain) {
      throw new Error('Web Audio master gain is not available')
    }

    return this.masterGain
  }

  private removeTrackDelayEffect(trackId: string): void {
    const effect = this.delayEffects.get(trackId)

    if (!effect) return

    disconnectNode(effect.chain.input)
    disconnectNode(effect.chain.delay)
    disconnectNode(effect.chain.feedback)
    disconnectNode(effect.chain.dry)
    disconnectNode(effect.chain.wet)
    disconnectNode(effect.chain.output)
    this.delayEffects.delete(trackId)
  }

  private bufferForSampleAction(
    action: Extract<SampleVoiceAction, { type: 'sample:start' }>
  ): AudioBuffer {
    if (!this.context) {
      throw new Error('Web Audio context is not available')
    }

    const existingBuffer = this.sampleBuffers.get(action.assetId)

    if (existingBuffer) return existingBuffer

    const buffer = createFallbackSampleBuffer(this.context, action.assetId)
    this.sampleBuffers.set(action.assetId, buffer)
    return buffer
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

  private updateActiveMixerNodes(): void {
    if (!this.context) return

    const time = this.context.currentTime

    for (const voice of this.voices.values()) {
      this.applyMixerToNodes(voice.trackId, voice.mixerGain, voice.panner, time)
    }

    for (const sample of this.samples.values()) {
      this.applyMixerToNodes(sample.trackId, sample.mixerGain, sample.panner, time)
    }
  }

  private applyMixerToNodes(
    trackId: string | undefined,
    mixerGain: GainNode,
    panner: StereoPannerNode,
    time: number,
    immediate = false
  ): void {
    const mixer = this.mixerForTrack(trackId)
    const gain = effectiveMixerGain(mixer, this.anySoloedTrack())
    const pan = mixer.pan

    if (immediate) {
      mixerGain.gain.setValueAtTime(gain, time)
      panner.pan.setValueAtTime(pan, time)
      return
    }

    mixerGain.gain.setTargetAtTime(gain, time, 0.01)
    panner.pan.setTargetAtTime(pan, time, 0.01)
  }

  private mixerForTrack(trackId: string | undefined): TrackMixerState {
    if (!trackId) return defaultTrackMixer()

    return this.trackMixers.get(trackId) ?? defaultTrackMixer()
  }

  private anySoloedTrack(): boolean {
    return [...this.trackMixers.values()].some((mixer) => mixer.solo)
  }

  private updateActiveTrackVoices(
    trackId: string,
    previousSettings: WebAudioOscillatorSettings,
    settings: WebAudioOscillatorSettings
  ): void {
    if (!this.context) return

    const waveformChanged = previousSettings.waveform !== settings.waveform
    const volumeChanged = previousSettings.volume !== settings.volume
    const filterChanged = !filterSettingsEqual(
      previousSettings.filter,
      settings.filter
    )

    for (const [key, voice] of this.voices.entries()) {
      if (voice.trackId !== trackId) continue

      if (!settings.enabled) {
        this.stopVoice(key, performanceNow())
        continue
      }

      if (waveformChanged) {
        voice.oscillator.type = settings.waveform
      }

      if (filterChanged) {
        configureFilter(
          voice.filter,
          settings.filter,
          voice.pitch,
          this.context.currentTime
        )
      }

      if (volumeChanged) {
        voice.trackGain.gain.setTargetAtTime(
          settings.volume,
          this.context.currentTime,
          0.01
        )
      }
    }
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(1, Math.max(0, value))
}

function clampBipolar(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(1, Math.max(-1, value))
}

function defaultTrackMixer(): TrackMixerState {
  return {
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false
  }
}

function normalizeTrackMixer(mixer: TrackMixerState): TrackMixerState {
  return {
    volume: clampUnit(mixer.volume),
    pan: clampBipolar(mixer.pan),
    mute: Boolean(mixer.mute),
    solo: Boolean(mixer.solo)
  }
}

function effectiveMixerGain(
  mixer: TrackMixerState,
  anySoloedTrack: boolean
): number {
  if (anySoloedTrack && !mixer.solo) return 0
  if (mixer.mute) return 0

  return clampUnit(mixer.volume)
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
    attack: clampSeconds(envelope?.attack ?? 0.01, 3),
    decay: clampSeconds(envelope?.decay ?? 0.15, 3),
    sustain: clampUnit(envelope?.sustain ?? 0.7),
    release: clampSeconds(envelope?.release ?? 0.2, 3)
  }
}

function settingsEqual(
  left: WebAudioOscillatorSettings,
  right: WebAudioOscillatorSettings
): boolean {
  return (
    left.enabled === right.enabled &&
    left.waveform === right.waveform &&
    left.volume === right.volume &&
    adsrSettingsEqual(left.adsr, right.adsr) &&
    filterSettingsEqual(left.filter, right.filter)
  )
}

function adsrSettingsEqual(
  left: WebAudioAdsrSettings,
  right: WebAudioAdsrSettings
): boolean {
  return (
    left.attackMs === right.attackMs &&
    left.decayMs === right.decayMs &&
    left.sustain === right.sustain &&
    left.releaseMs === right.releaseMs
  )
}

function filterSettingsEqual(
  left: WebAudioFilterSettings,
  right: WebAudioFilterSettings
): boolean {
  return (
    left.cutoff === right.cutoff &&
    left.resonance === right.resonance &&
    left.keyTracking === right.keyTracking
  )
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

function sampleDurationSeconds(
  buffer: AudioBuffer,
  action: Extract<SampleVoiceAction, { type: 'sample:start' }>
): number | undefined {
  if (action.loopEnabled) return undefined

  const start = sampleOffsetSeconds(buffer, action)
  const end = action.endSeconds === undefined
    ? buffer.duration
    : Math.min(buffer.duration, Math.max(start, action.endSeconds))
  const duration = end - start

  return duration > 0 ? duration : undefined
}

function sampleOffsetSeconds(
  buffer: AudioBuffer,
  action: Extract<SampleVoiceAction, { type: 'sample:start' }>
): number {
  return Math.min(buffer.duration, Math.max(0, action.startSeconds))
}

function createFallbackSampleBuffer(
  context: AudioContext,
  assetId: string
): AudioBuffer {
  const durationSeconds = 0.18
  const length = Math.max(1, Math.floor(context.sampleRate * durationSeconds))
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  const frequency = fallbackSampleFrequency(assetId)

  for (let index = 0; index < data.length; index += 1) {
    const progress = index / data.length
    const envelope = Math.exp(-progress * 8)
    data[index] = Math.sin((index / context.sampleRate) * frequency * Math.PI * 2) *
      envelope *
      0.4
  }

  return buffer
}

function fallbackSampleFrequency(assetId: string): number {
  let hash = 0

  for (let index = 0; index < assetId.length; index += 1) {
    hash = (hash * 31 + assetId.charCodeAt(index)) >>> 0
  }

  return 110 + (hash % 36) * 10
}

function disconnectNode(node: AudioNode): void {
  try {
    node.disconnect()
  } catch {
    // Already disconnected effect nodes are safe to ignore.
  }
}

function performanceNow(): number {
  return globalThis.performance?.now() ?? Date.now()
}

declare global {
  var webkitAudioContext: typeof AudioContext | undefined
}
