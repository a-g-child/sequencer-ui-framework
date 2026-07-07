import type { DocumentObserver, Operation, Service, ServiceContext, ServiceEvent } from '@sequencer/core'
import {
  BasicSynthFactory,
  ExternalMidiFactory,
  getRuntimeParameterEffectiveValue
} from '@sequencer/device'
import { PlaybackModelBuilder } from './builder'
import type { ClockState } from './clock'
import {
  PlaybackDeviceManager,
  type PlaybackDeviceManagerStatus
} from './device'
import type { PlaybackEvent } from './events'
import {
  LiveClipService,
  type AppliedClipLaunch,
  type ClipLaunchQuantize,
  type LiveClipState
} from './live-clips'
import type { PlaybackModel } from './model'
import {
  ConsoleOutput,
  EventLoggerOutput,
  MidiOutputStub,
  OutputManager,
  StatisticsOutput,
  WebAudioOutput,
  type OutputManagerStatus
} from './output'
import type { PlaybackOutputStatistics } from './output/StatisticsOutput'
import type {
  WebAudioOscillatorSettings,
  WebAudioOscillatorSettingsUpdate,
  WebAudioWaveform
} from './output/WebAudioOutput'
import {
  samplePlaybackAutomationValues,
  TypeScriptScheduler,
  type PlaybackRuntimeParameterValue,
  type Scheduler,
  type SchedulerStatus
} from './scheduler'

export interface PlaybackServiceStatus extends SchedulerStatus {
  readonly modelId: string
  readonly noteCount: number
  readonly liveClips: LiveClipState
  readonly outputManager: OutputManagerStatus
  readonly deviceManager: PlaybackDeviceManagerStatus
  readonly voice?: PlaybackVoiceStatus
  readonly statistics: PlaybackOutputStatistics
  readonly webAudio: {
    readonly defaultSettings: WebAudioOscillatorSettings
    readonly trackSettings: Readonly<Record<string, WebAudioOscillatorSettings>>
  }
}

export interface PlaybackVoiceStatus {
  readonly active: number
  readonly released: number
  readonly stolen: number
  readonly totalStarted: number
  readonly totalReleased: number
  readonly totalStolen: number
}

export class PlaybackService implements Service, DocumentObserver {
  readonly id = 'playback'
  readonly name = 'Playback'

  private context?: ServiceContext
  private model?: PlaybackModel
  private runtimeBpm?: number
  private latestClockState: ClockState | undefined
  private readonly builder = new PlaybackModelBuilder()
  private readonly liveClips = new LiveClipService('bar')
  private readonly scheduler: Scheduler & { readonly status?: SchedulerStatus }
  private readonly deviceManager = new PlaybackDeviceManager()
  private readonly outputManager = new OutputManager()
  private readonly statisticsOutput = new StatisticsOutput()
  private readonly webAudioOutput = new WebAudioOutput()
  private unsubscribeServiceEvents?: () => void

  constructor(scheduler?: Scheduler & { readonly status?: SchedulerStatus }) {
    this.scheduler = scheduler ?? new TypeScriptScheduler()
  }

  async initialise(context: ServiceContext): Promise<void> {
    this.context = context
    context.documentStore.addObserver(this)
    this.unsubscribeServiceEvents = context.events.subscribe((event) =>
      this.handleServiceEvent(event)
    )
    await this.initialiseOutputs()
    await this.initialiseDevices()
    this.rebuildModel()
    this.emitStatus()
  }

  async shutdown(): Promise<void> {
    this.scheduler.stop()
    await this.deviceManager.disconnectAll()
    await this.outputManager.disconnectAll()
    this.context?.documentStore.removeObserver(this)
    this.unsubscribeServiceEvents?.()
    this.context = undefined
  }

  get status(): PlaybackServiceStatus {
    const status = this.scheduler.status ?? {
      running: false,
      queuedEventCount: 0,
      currentBeat: 0,
      lastEmittedEvent: undefined,
      lookaheadDepthBeats: 0,
      maxLookaheadDepthBeats: 0,
      lookaheadDepthMs: 0,
      maxLookaheadDepthMs: 0,
      largestEventBatch: 0
    }

    return {
      ...status,
      modelId: this.model?.id ?? '',
      noteCount: this.model?.notes.length ?? 0,
      liveClips: this.liveClips.state,
      outputManager: this.outputManager.status,
      deviceManager: this.deviceManager.status,
      voice: this.voiceStatus(),
      statistics: this.statisticsOutput.statistics,
      webAudio: this.webAudioOutput.settings
    }
  }

  private voiceStatus(): PlaybackVoiceStatus | undefined {
    const voiceStats = this.deviceManager
      .getDiagnostics()
      .map((entry) => voiceStatsFromDiagnostics(entry.diagnostics))
      .find((stats) => stats !== undefined)

    if (!voiceStats) return undefined

    return {
      active: voiceStats.activeVoices,
      released: voiceStats.releasedVoices,
      stolen: voiceStats.stolenVoices,
      totalStarted: voiceStats.totalStarted,
      totalReleased: voiceStats.totalReleased,
      totalStolen: voiceStats.totalStolen
    }
  }

  onCommandExecuted(_operation: Operation): void {
    void this.rebuildRuntimeDevices()
    this.rebuildModel()
  }

  onCommandUndone(_operation: Operation): void {
    void this.rebuildRuntimeDevices()
    this.rebuildModel()
  }

  onCommandRedone(_operation: Operation): void {
    void this.rebuildRuntimeDevices()
    this.rebuildModel()
  }

  requestClipLaunch(
    trackId: string,
    clipId: string,
    launchQuantize: ClipLaunchQuantize | number = this.liveClips.state.launchQuantizeBeats
  ): void {
    const previousClipId = this.liveClips.state.activeClipByTrackId[trackId]?.clipId

    this.liveClips.requestLaunch(
      trackId,
      clipId,
      this.latestClockState ?? this.createStoppedClockState(),
      launchQuantize
    )
    const activeClipId = this.liveClips.state.activeClipByTrackId[trackId]?.clipId

    if (activeClipId === clipId) {
      this.clearTrackVoicesAfterClipSwitch(trackId, previousClipId, clipId)
    }
    this.rebuildModel()
    this.emitStatus()
  }

  cancelClipLaunch(trackId: string): void {
    this.liveClips.cancelLaunch(trackId)
    this.emitStatus()
  }

  setClipLaunchQuantize(launchQuantize: ClipLaunchQuantize | number): void {
    this.liveClips.setLaunchQuantize(launchQuantize)
    this.emitStatus()
  }

  clearActiveClipForTrack(trackId: string): void {
    const previousClipId = this.liveClips.state.activeClipByTrackId[trackId]?.clipId

    this.liveClips.clearActiveClip(trackId)
    if (previousClipId) {
      this.outputManager.panicTrack(trackId)
    }
    this.rebuildModel()
    this.emitStatus()
  }

  activeClipForTrack(trackId: string): string | undefined {
    return this.liveClips.state.activeClipByTrackId[trackId]?.clipId
  }

  async setWebAudioEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.outputManager.connect(this.webAudioOutput.id)
    } else {
      await this.outputManager.disconnect(this.webAudioOutput.id)
    }

    this.emitStatus()
  }

  setWebAudioWaveform(waveform: WebAudioWaveform): void {
    this.webAudioOutput.setWaveform(waveform)
    this.emitStatus()
  }

  setWebAudioVolume(volume: number): void {
    this.webAudioOutput.setVolume(volume)
    this.emitStatus()
  }

  setWebAudioTrackSettings(
    trackId: string,
    settings: WebAudioOscillatorSettingsUpdate
  ): void {
    this.webAudioOutput.setTrackSettings(trackId, settings)
    this.emitStatus()
  }

  webAudioTrackSettings(
    trackId: string | undefined
  ): WebAudioOscillatorSettings {
    return this.webAudioOutput.trackSettingsFor(trackId)
  }

  private rebuildModel(): void {
    if (!this.context) return

    const startedAt = nowMs()
    this.model = this.builder.build(
      this.context.documentStore.document,
      this.runtimeBpm,
      { activeClipsByTrackId: this.liveClips.state.activeClipByTrackId }
    )
    this.scheduler.setModel(this.model)
    this.statisticsOutput.recordPlaybackModelRebuild(nowMs() - startedAt)
    this.emitStatus()
  }

  private clearTrackVoicesAfterClipSwitch(
    trackId: string,
    previousClipId: string | undefined,
    nextClipId: string
  ): void {
    if (!previousClipId || previousClipId === nextClipId) return

    this.outputManager.panicTrack(trackId)
  }

  private clearTrackVoicesForAppliedLaunches(
    launches: readonly AppliedClipLaunch[]
  ): void {
    for (const launch of launches) {
      this.clearTrackVoicesAfterClipSwitch(
        launch.trackId,
        launch.previousClipId,
        launch.clipId
      )
    }
  }

  private handleServiceEvent(event: ServiceEvent): void {
    if (event.serviceId === this.id) return

    if (event.type === 'clock:started') {
      const state = event.payload as ClockState
      this.latestClockState = state
      this.runtimeBpm = state.bpm
      if (state.beat === 0) {
        this.liveClips.resetLaunchOrigins(0)
      }
      this.clearTrackVoicesForAppliedLaunches(this.liveClips.applyDueLaunches(state))
      this.rebuildModel()
      this.scheduler.start(state.beat)
      this.emitStatus()
    }

    if (event.type === 'clock:stopped') {
      this.latestClockState = event.payload as ClockState
      this.scheduler.stop()
      this.outputManager.panic()
      this.liveClips.resetLaunchOrigins(0)
      this.rebuildModel()
      this.emitStatus()
    }

    if (event.type === 'clock:seeked') {
      const state = event.payload as ClockState
      this.latestClockState = state
      this.scheduler.seek(state.beat)
      this.emitStatus()
    }

    if (event.type === 'clock:tempo-changed') {
      const state = event.payload as ClockState
      this.latestClockState = state
      this.runtimeBpm = state.bpm
      this.rebuildModel()
    }

    if (event.type === 'clock:tick') {
      const state = event.payload as ClockState
      const previousTimeMs = this.latestClockState?.timeMs ?? state.timeMs
      this.latestClockState = state

      const appliedLaunches = this.liveClips.applyDueLaunches(state)

      if (appliedLaunches.length > 0) {
        this.clearTrackVoicesForAppliedLaunches(appliedLaunches)
        this.rebuildModel()
      }

      const events = this.scheduler.tick(state)
      const dispatchTimeMs = nowMs()
      this.deviceManager.advance(Math.max(0, state.timeMs - previousTimeMs))

      this.statisticsOutput.recordSchedulerFrame({
        clockTimeMs: state.timeMs,
        dispatchTimeMs,
        events,
        schedulerStatus: this.status
      })
      const voiceActions = this.deviceManager.processEvents(events)
      this.syncBasicSynthRuntimeParametersToWebAudio()
      this.webAudioOutput.handleVoiceActions(voiceActions)
      this.outputManager.handleEvents(events)
      this.emitPlaybackEvents(events)
      this.emitRuntimeParameterValues(state)
      this.emitStatus()
    }
  }

  private async initialiseOutputs(): Promise<void> {
    if (this.outputManager.registry.outputs().length > 0) return

    await this.outputManager.register(new ConsoleOutput())
    await this.outputManager.register(new MidiOutputStub(), false)
    await this.outputManager.register(this.webAudioOutput, false)
    await this.outputManager.register(new EventLoggerOutput(), false)
    await this.outputManager.register(this.statisticsOutput)
  }

  private async initialiseDevices(): Promise<void> {
    this.deviceManager.register(new BasicSynthFactory<PlaybackEvent>())
    this.deviceManager.register(new ExternalMidiFactory<PlaybackEvent>())
    await this.rebuildRuntimeDevices()
  }

  private async rebuildRuntimeDevices(): Promise<void> {
    if (!this.context) return

    await this.deviceManager.disconnectAll()
    this.deviceManager.buildFromInstances(
      this.context.documentStore.document.deviceInstances.values()
    )
    await this.deviceManager.connectAll()
    this.syncBasicSynthRuntimeParametersToWebAudio()
    this.emitStatus()
  }

  private syncBasicSynthRuntimeParametersToWebAudio(): void {
    if (!this.context) return

    for (const track of this.context.documentStore.document.tracks.values()) {
      if (!track.deviceId) continue

      const device = this.deviceManager.runtimeDevices.find(track.deviceId)

      if (!device || device.descriptorKey !== 'basic-synth') continue

      this.webAudioOutput.setTrackSettings(track.id, {
        enabled: true,
        waveform: normalizeWebAudioWaveform(
          getRuntimeParameterEffectiveValue(device.parameters, 'waveform')
        ),
        volume: normalizeRuntimeVolume(
          getRuntimeParameterEffectiveValue(device.parameters, 'volume')
        ),
        filter: {
          cutoff: normalizeRuntimeFilterCutoff(
            getRuntimeParameterEffectiveValue(device.parameters, 'cutoff')
          ),
          resonance: normalizeRuntimeFilterResonance(
            getRuntimeParameterEffectiveValue(device.parameters, 'resonance')
          ),
          keyTracking: normalizeRuntimeKeyTracking(
            getRuntimeParameterEffectiveValue(device.parameters, 'keyTracking')
          )
        }
      })
    }
  }

  private emitStatus(): void {
    this.context?.events.emit({
      type: 'playback:status-changed',
      serviceId: this.id,
      payload: this.status
    })
  }

  private emitPlaybackEvents(events: readonly PlaybackEvent[]): void {
    if (events.length === 0) return

    this.context?.events.emit({
      type: 'playback:events',
      serviceId: this.id,
      payload: events
    })
  }

  private emitRuntimeParameterValues(state: ClockState): void {
    if (!this.model) return

    const values = samplePlaybackAutomationValues(this.model, state.beat)

    this.context?.events.emit<readonly PlaybackRuntimeParameterValue[]>({
      type: 'playback:runtime-parameters',
      serviceId: this.id,
      payload: values
    })
  }

  private createStoppedClockState(): ClockState {
    return {
      running: false,
      beat: this.scheduler.status?.currentBeat ?? 0,
      bpm: this.runtimeBpm ?? this.context?.documentStore.document.bpm ?? 120,
      timeMs: nowMs(),
      sourceId: 'playback'
    }
  }

}

export type { PlaybackEvent }

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}

function normalizeWebAudioWaveform(value: unknown): WebAudioWaveform {
  if (
    value === 'sine' ||
    value === 'square' ||
    value === 'sawtooth' ||
    value === 'triangle'
  ) {
    return value
  }

  return 'sine'
}

function normalizeRuntimeVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.25

  return Math.min(1, Math.max(0, value))
}

function normalizeRuntimeFilterCutoff(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 20000

  return Math.min(20000, Math.max(20, value))
}

function normalizeRuntimeFilterResonance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0

  return Math.min(20, Math.max(0, value))
}

function normalizeRuntimeKeyTracking(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0

  return Math.min(1, Math.max(0, value))
}

function voiceStatsFromDiagnostics(
  diagnostics: unknown
): {
  readonly activeVoices: number
  readonly releasedVoices: number
  readonly stolenVoices: number
  readonly totalStarted: number
  readonly totalReleased: number
  readonly totalStolen: number
} | undefined {
  if (
    typeof diagnostics !== 'object' ||
    diagnostics === null ||
    !('voices' in diagnostics)
  ) {
    return undefined
  }

  const voices = diagnostics.voices

  if (typeof voices !== 'object' || voices === null) return undefined

  if (
    !hasNumber(voices, 'activeVoices') ||
    !hasNumber(voices, 'releasedVoices') ||
    !hasNumber(voices, 'stolenVoices') ||
    !hasNumber(voices, 'totalStarted') ||
    !hasNumber(voices, 'totalReleased') ||
    !hasNumber(voices, 'totalStolen')
  ) {
    return undefined
  }

  return voices
}

function hasNumber<T extends string>(
  value: object,
  key: T
): value is Record<T, number> {
  return key in value && typeof value[key as keyof typeof value] === 'number'
}
