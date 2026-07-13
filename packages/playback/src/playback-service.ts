import type { AssetReference } from '@sequencer/assets'
import {
  AudioGraphBuilder,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  buildDeviceChainGraph,
  type AudioGraphDiagnostic,
  type RuntimeAudioGraph,
  type RuntimeNodeDiagnostics
} from '@sequencer/audio-graph'
import type { DocumentObserver, Operation, Service, ServiceContext, ServiceEvent } from '@sequencer/core'
import {
  ArpeggiatorFactory,
  BasicSynthFactory,
  DelayFactory,
  ExternalMidiFactory,
  LfoFactory,
  SamplerFactory,
  getRuntimeParameterEffectiveValue
} from '@sequencer/device'
import { PlaybackModelBuilder } from './builder.ts'
import type { ClockState } from './clock.ts'
import {
  PlaybackDeviceManager,
  type PlaybackDeviceDiagnostics,
  type PlaybackDeviceManagerStatus
} from './device.ts'
import type { PlaybackEvent } from './events.ts'
import {
  LiveClipService,
  type AppliedClipLaunch,
  type ClipLaunchQuantize,
  type LiveClipState
} from './live-clips.ts'
import type { PlaybackModel } from './model.ts'
import { NativeAudioAdapter } from './native/NativeAudioAdapter.ts'
import { compilePlaybackModelToNativePlan } from './native/PlaybackModelCompiler.ts'
import {
  compileNativeClipSchedule,
  createNativeTempoMapCommand,
  createNativeTransportLoopCommand,
  nativeClipImmediateNoteOffCommands,
  nativeClipScheduleBatchCommand,
  nativeScheduledEventOwnerGenerationCommand,
  NativeClipScheduleSubmissionState,
} from './native/NativeClipSchedule.ts'
import {
  PlaybackRuntimeController,
} from './native/PlaybackRuntimeController.ts'
import type {
  PlaybackRuntimeControllerStatus,
  RuntimeSnapshot
} from './native/RuntimeTypes.ts'
import type { EngineCommand } from './native/schemas.ts'
import { createPanicDeviceCommand } from './native/voice-action-commands.ts'
import {
  ConsoleOutput,
  EventLoggerOutput,
  MidiOutputStub,
  OutputManager,
  StatisticsOutput,
  WebAudioOutput,
  WebMidiOutput,
  type OutputManagerStatus
} from './output.ts'
import type { PlaybackOutputStatistics } from './output/StatisticsOutput.ts'
import type {
  WebAudioOscillatorSettings,
  WebAudioOscillatorSettingsUpdate,
  WebAudioWaveform
} from './output/WebAudioOutput.ts'
import type { WebMidiOutputStatus } from './output/WebMidiOutput.ts'
import {
  samplePlaybackAutomationValues,
  TypeScriptScheduler,
  type PlaybackRuntimeParameterValue,
  type Scheduler,
  type SchedulerStatus
} from './scheduler.ts'

const MIN_NATIVE_SCHEDULE_LEAD_SAMPLES = 4096
const NATIVE_SCHEDULE_LEAD_SECONDS = 0.25

export interface PlaybackServiceStatus extends SchedulerStatus {
  readonly modelId: string
  readonly noteCount: number
  readonly liveClips: LiveClipState
  readonly outputManager: OutputManagerStatus
  readonly deviceManager: PlaybackDeviceManagerStatus
  readonly deviceDiagnostics: readonly PlaybackDeviceDiagnostics[]
  readonly trackGraphDiagnostics: readonly PlaybackTrackGraphDiagnostics[]
  readonly voice?: PlaybackVoiceStatus
  readonly statistics: PlaybackOutputStatistics
  readonly webAudio: {
    readonly defaultSettings: WebAudioOscillatorSettings
    readonly trackSettings: Readonly<Record<string, WebAudioOscillatorSettings>>
  }
  readonly webMidi: WebMidiOutputStatus
  readonly runtime?: PlaybackRuntimeControllerStatus
  readonly nativeRuntime: PlaybackNativeRuntimeStatus
}

export interface PlaybackNativeRuntimeStatus {
  readonly lastAction: string
  readonly lastCommandTypes: readonly string[]
  readonly lastError?: string
}

export interface PlaybackTrackGraphDiagnostics {
  readonly trackId: string
  readonly trackName: string
  readonly graph: PlaybackRuntimeGraphDiagnostics
}

export interface PlaybackRuntimeGraphDiagnostics {
  readonly presetId: string
  readonly nodeCount: number
  readonly connectionCount: number
  readonly latencySamples: number
  readonly executionOrder: readonly string[]
  readonly diagnostics: readonly AudioGraphDiagnostic[]
  readonly nodeDiagnostics: readonly RuntimeNodeDiagnostics[]
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
  private readonly trackGraphBuilder = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS)
  private readonly liveClips = new LiveClipService('bar')
  private readonly scheduler: Scheduler & { readonly status?: SchedulerStatus }
  private readonly deviceManager = new PlaybackDeviceManager()
  private readonly outputManager = new OutputManager()
  private readonly nativeAudioAdapter = new NativeAudioAdapter()
  private readonly statisticsOutput = new StatisticsOutput()
  private readonly webAudioOutput = new WebAudioOutput()
  private readonly webMidiOutput = new WebMidiOutput()
  private readonly nativeClipScheduleSubmissions = new NativeClipScheduleSubmissionState()
  private nativeRuntimeStatus: PlaybackNativeRuntimeStatus = {
    lastAction: 'idle',
    lastCommandTypes: []
  }
  private unsubscribeServiceEvents?: () => void
  private unsubscribeRuntimeController?: () => void
  private activeNativeCompilation?: {
    readonly planId: string
    readonly revision: number
    readonly modelKey: string
  }
  private pendingNativePlanPreparation?: {
    readonly modelKey: string
    readonly promise: Promise<void>
  }

  constructor(
    scheduler?: Scheduler & { readonly status?: SchedulerStatus },
    private readonly runtimeController?: PlaybackRuntimeController
  ) {
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
    if (this.runtimeController) {
      this.unsubscribeRuntimeController = this.runtimeController.subscribe(() => {
        this.emitRuntimeSnapshot()
        this.emitStatus()
      })
      await this.runtimeController.start()
    }
    this.rebuildModel()
    if (this.runtimeController) {
      await this.prepareNativeRuntimePlan(this.model)
    }
    this.emitStatus()
  }

  async shutdown(): Promise<void> {
    this.panicRuntimeVoices()
    this.scheduler.stop()
    this.unsubscribeRuntimeController?.()
    await this.runtimeController?.dispose()
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
      deviceDiagnostics: this.deviceManager.getDiagnostics(),
      trackGraphDiagnostics: this.getTrackGraphDiagnostics(),
      voice: this.voiceStatus(),
      statistics: this.statisticsOutput.statistics,
      webAudio: this.webAudioOutput.settings,
      webMidi: this.webMidiOutput.status,
      runtime: this.runtimeController?.status,
      nativeRuntime: this.nativeRuntimeStatus
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

  onCommandExecuted(operation: Operation): void {
    if (this.applyRuntimeDeviceParameterOperation(operation)) {
      this.syncRuntimeParametersToWebAudio()
      this.emitStatus()
      return
    }

    if (isTrackMixerOperation(operation)) {
      this.rebuildModel()
      return
    }

    if (isPlaybackModelOperation(operation)) {
      this.handlePlaybackModelOperation()
      return
    }

    void this.rebuildRuntimeDevicesAndModel()
  }

  onCommandUndone(operation: Operation): void {
    if (this.applyRuntimeDeviceParameterOperation(operation)) {
      this.syncRuntimeParametersToWebAudio()
      this.emitStatus()
      return
    }

    if (isTrackMixerOperation(operation)) {
      this.rebuildModel()
      return
    }

    if (isPlaybackModelOperation(operation)) {
      this.handlePlaybackModelOperation()
      return
    }

    void this.rebuildRuntimeDevicesAndModel()
  }

  onCommandRedone(operation: Operation): void {
    if (this.applyRuntimeDeviceParameterOperation(operation)) {
      this.syncRuntimeParametersToWebAudio()
      this.emitStatus()
      return
    }

    if (isTrackMixerOperation(operation)) {
      this.rebuildModel()
      return
    }

    if (isPlaybackModelOperation(operation)) {
      this.handlePlaybackModelOperation()
      return
    }

    void this.rebuildRuntimeDevicesAndModel()
  }

  private handlePlaybackModelOperation(): void {
    if (!this.runtimeController) {
      this.panicRuntimeVoices()
      this.rebuildModel()
      return
    }

    const previousClockState = this.latestClockState

    this.rebuildModel({ submitNativeClipSchedule: false })

    if (previousClockState?.running) {
      this.setNativeRuntimeStatus('clip-schedule-replace-deferred')
      return
    }

    this.submitNativeClipScheduleReplacement()
  }

  private applyRuntimeDeviceParameterOperation(operation: Operation): boolean {
    if (!isDeviceParameterOperation(operation)) return false
    if (!this.context) return false

    const device = this.context.documentStore.document.deviceInstances.find(
      operation.deviceInstanceId
    )
    const value = device?.parameterValues[operation.parameterKey]

    if (value === undefined) return false

    const applied = this.deviceManager.setRuntimeParameterValue(
      operation.deviceInstanceId,
      operation.parameterKey,
      value
    )

    if (applied) {
      this.deviceManager.advance(
        20,
        this.runtimeBpm ?? this.context.documentStore.document.bpm
      )
    }

    return applied
  }

  private panicRuntimeVoices(): void {
    this.outputManager.panic()
    this.deviceManager.panic()
    this.nativeAudioAdapter.handleCommands([
      createPanicDeviceCommand({
        reason: 'runtime-panic',
        timeMs: nowMs()
      })
    ])
    void this.runtimeController?.panic().catch(() => {})
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

  requestClipLaunches(
    launches: ReadonlyArray<{ trackId: string; clipId: string }>,
    launchQuantize: ClipLaunchQuantize | number = this.liveClips.state.launchQuantizeBeats
  ): void {
    if (launches.length === 0) return

    const clockState = this.latestClockState ?? this.createStoppedClockState()
    const previousClipIdByTrackId = Object.fromEntries(
      launches.map(({ trackId }) => [
        trackId,
        this.liveClips.state.activeClipByTrackId[trackId]?.clipId
      ])
    )

    for (const { trackId, clipId } of launches) {
      this.liveClips.requestLaunch(
        trackId,
        clipId,
        clockState,
        launchQuantize
      )
    }

    for (const { trackId, clipId } of launches) {
      const activeClipId =
        this.liveClips.state.activeClipByTrackId[trackId]?.clipId

      if (activeClipId === clipId) {
        this.clearTrackVoicesAfterClipSwitch(
          trackId,
          previousClipIdByTrackId[trackId],
          clipId
        )
      }
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

    if (previousClipId) {
      this.submitNativeClipStop(previousClipId)
    }
    this.liveClips.clearActiveClip(trackId)
    if (previousClipId) {
      this.panicTrackRuntimeVoices(trackId, 'clip-stop')
    }
    this.rebuildModel()
    this.emitStatus()
  }

  activeClipForTrack(trackId: string): string | undefined {
    return this.liveClips.state.activeClipByTrackId[trackId]?.clipId
  }

  panic(): void {
    this.panicRuntimeVoices()
    this.emitStatus()
  }

  async setWebAudioEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.outputManager.connect(this.webAudioOutput.id)
      this.syncRuntimeParametersToWebAudio()
    } else {
      this.panicRuntimeVoices()
      await this.outputManager.disconnect(this.webAudioOutput.id)
    }

    this.emitStatus()
  }

  async setWebMidiEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.outputManager.connect(this.webMidiOutput.id)

      if (!this.webMidiOutput.status.connected) {
        await this.outputManager.disconnect(this.webMidiOutput.id)
      }
    } else {
      await this.outputManager.disconnect(this.webMidiOutput.id)
    }

    this.emitStatus()
  }

  async loadSampleAsset(asset: AssetReference): Promise<AudioBuffer> {
    return this.webAudioOutput.loadSampleAsset(asset)
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

  private rebuildModel(
    options: {
      readonly prepareNativeRuntimePlan?: boolean
      readonly submitNativeClipSchedule?: boolean
    } = {}
  ): void {
    if (!this.context) return

    const startedAt = nowMs()
    this.model = this.builder.build(
      this.context.documentStore.document,
      this.runtimeBpm,
      { activeClipsByTrackId: this.liveClips.state.activeClipByTrackId }
    )
    this.scheduler.setModel(this.model)
    this.deviceManager.configureTrackDeviceChains(this.model.tracks)
    this.syncTrackMixersToWebAudio()
    this.syncRuntimeParametersToWebAudio()
    this.statisticsOutput.recordPlaybackModelRebuild(nowMs() - startedAt)
    if (this.runtimeController && options.prepareNativeRuntimePlan !== false) {
      void this.prepareNativeRuntimePlan(this.model).catch((error) => {
        this.runtimeController?.fail(error)
      })
    }
    if (options.submitNativeClipSchedule !== false) {
      this.submitNativeClipScheduleReplacement()
    }
    this.emitStatus()
  }

  private clearTrackVoicesAfterClipSwitch(
    trackId: string,
    previousClipId: string | undefined,
    nextClipId: string
  ): void {
    if (!previousClipId || previousClipId === nextClipId) return

    this.panicTrackRuntimeVoices(trackId, 'clip-switch')
  }

  private panicTrackRuntimeVoices(trackId: string, reason: string): void {
    this.outputManager.panicTrack(trackId)
    this.nativeAudioAdapter.handleCommands([
      createPanicDeviceCommand({
        reason,
        trackId,
        timeMs: nowMs()
      })
    ])
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
      this.liveClips.resetLaunchOrigins(state.beat)
      this.clearTrackVoicesForAppliedLaunches(this.liveClips.applyDueLaunches(state))
      this.rebuildModel({ prepareNativeRuntimePlan: false })
      if (this.runtimeController) {
        void this.prepareAndStartNativeRuntime(state).catch((error) => {
          this.setNativeRuntimeStatus('transport-start-failed', [], error)
          this.runtimeController?.fail(error)
          this.stopClockAfterNativeStartFailure()
        })
      } else {
        this.scheduler.start(state.beat)
      }
      this.emitStatus()
    }

    if (event.type === 'clock:stopped') {
      this.latestClockState = event.payload as ClockState
      this.scheduler.stop()
      this.nativeClipScheduleSubmissions.stop()
      if (this.runtimeController) {
        void this.runtimeController.stop().catch(() => {})
      } else {
        this.panicRuntimeVoices()
      }
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
      if (this.runtimeController) {
        this.rebuildModel({
          prepareNativeRuntimePlan: false,
          submitNativeClipSchedule: false
        })
        this.submitNativeTempoMapUpdate(state)
      } else {
        this.rebuildModel()
      }
    }

    if (event.type === 'clock:tick') {
      const state = event.payload as ClockState
      const previousTimeMs = this.latestClockState?.timeMs ?? state.timeMs
      this.latestClockState = state

      if (this.runtimeController) {
        void this.runtimeController.refreshSnapshot().catch(() => {})
        const appliedLaunches = this.liveClips.applyDueLaunches(state)

        if (appliedLaunches.length > 0) {
          this.clearTrackVoicesForAppliedLaunches(appliedLaunches)
          this.rebuildModel({ prepareNativeRuntimePlan: false })
        }

        this.emitStatus()
        return
      }

      const appliedLaunches = this.liveClips.applyDueLaunches(state)

      if (appliedLaunches.length > 0) {
        this.clearTrackVoicesForAppliedLaunches(appliedLaunches)
        this.rebuildModel()
      }

      const events = this.scheduler.tick(state)
      const dispatchTimeMs = nowMs()
      this.deviceManager.advance(
        Math.max(0, state.timeMs - previousTimeMs),
        state.bpm
      )

      this.statisticsOutput.recordSchedulerFrame({
        clockTimeMs: state.timeMs,
        dispatchTimeMs,
        events,
        schedulerStatus: this.status
      })
      const deviceResult = this.deviceManager.processEvents(events)
      this.syncRuntimeParametersToWebAudio()
      this.nativeAudioAdapter.handleCommands(deviceResult.deviceCommands)
      this.webAudioOutput.handleVoiceActions(deviceResult.voiceActions)
      this.webAudioOutput.handleSampleActions(deviceResult.sampleActions)
      this.outputManager.handleEvents(events)
      this.emitPlaybackEvents(events)
      this.emitRuntimeParameterValues(state)
      this.emitStatus()
    }
  }

  private async prepareAndStartNativeRuntime(state: ClockState): Promise<void> {
    if (!this.runtimeController || !this.model) return

    this.setNativeRuntimeStatus('prepare-start')
    await this.prepareNativeRuntimePlan(this.model)
    this.setNativeRuntimeStatus('schedule-start')
    const startSample = await this.submitNativeClipSchedule(state, 'begin')
    this.setNativeRuntimeStatus('transport-start-requested')
    await this.runtimeController.play(
      startSample === undefined ? undefined : { atSample: startSample }
    )
    this.setNativeRuntimeStatus('transport-start-confirmed')
  }

  private stopClockAfterNativeStartFailure(): void {
    this.context?.events.emit({
      type: 'transport:playing-changed',
      serviceId: this.id,
      payload: { playing: false }
    })
    this.context?.events.emit({
      type: 'transport:beat-changed',
      serviceId: this.id,
      payload: { currentBeat: 0, currentStep: 0 }
    })
  }

  private async prepareNativeRuntimePlan(playbackModel: PlaybackModel | undefined): Promise<void> {
    if (!this.runtimeController || !playbackModel) return

    this.setNativeRuntimeStatus('plan-prepare')
    const modelKey = this.nativePlanInputKey(playbackModel)

    if (
      this.activeNativeCompilation &&
      this.activeNativeCompilation.modelKey === modelKey &&
      (this.runtimeController.status.snapshot?.plan.activePlanId ?? null) !== null
    ) {
      return
    }

    if (this.pendingNativePlanPreparation) {
      const pending = this.pendingNativePlanPreparation

      if (pending.modelKey === modelKey) {
        await pending.promise
        return
      }

      await pending.promise.catch(() => undefined)

      if (
        this.activeNativeCompilation &&
        this.activeNativeCompilation.modelKey === modelKey &&
        (this.runtimeController.status.snapshot?.plan.activePlanId ?? null) !== null
      ) {
        return
      }
    }

    const preparation = this.activateNativeRuntimePlan(playbackModel, modelKey)

    this.pendingNativePlanPreparation = {
      modelKey,
      promise: preparation
    }

    try {
      await preparation
    } finally {
      if (this.pendingNativePlanPreparation?.promise === preparation) {
        this.pendingNativePlanPreparation = undefined
      }
    }
  }

  private async activateNativeRuntimePlan(
    playbackModel: PlaybackModel,
    modelKey: string
  ): Promise<void> {
    if (!this.runtimeController) return

    const compilation = compilePlaybackModelToNativePlan(playbackModel)

    if (!compilation.support.supported) {
      const message = compilation.support.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.message)
        .join('; ')

      this.runtimeController.fail(new Error(message))
      throw new Error(message)
    }

    const snapshot = await this.runtimeController.compileAndActivate(compilation.plan)

    if (
      snapshot.plan.activePlanId === null ||
      snapshot.plan.activeRevision !== compilation.plan.revision
    ) {
      const message = `native runtime reported active plan ${snapshot.plan.activePlanId}/${snapshot.plan.activeRevision} instead of revision ${compilation.plan.revision}`
      this.runtimeController.fail(new Error(message))
      throw new Error(message)
    }

    this.activeNativeCompilation = {
      planId: compilation.plan.id,
      revision: compilation.plan.revision,
      modelKey
    }
    this.setNativeRuntimeStatus('plan-active')
  }

  private nativePlanInputKey(playbackModel: PlaybackModel): string {
    return JSON.stringify({
      tracks: playbackModel.tracks.map((track) => ({
        id: track.id,
        deviceInstanceIds: track.deviceInstanceIds ?? track.deviceInstanceId
      }))
    })
  }

  private submitNativeClipScheduleReplacement(): void {
    if (!this.runtimeController || !this.latestClockState?.running) return
    if (!this.runtimeController.status.snapshot?.transport.playing) return

    void this.submitNativeClipSchedule(this.latestClockState, 'replace').catch((error) => {
      this.setNativeRuntimeStatus('clip-schedule-replace-failed', [], error)
      this.runtimeController?.fail(error)
    })
  }

  private submitNativeTempoMapUpdate(state: ClockState): void {
    if (!this.runtimeController || !this.model) return
    if (!this.runtimeController.status.snapshot?.transport.playing) return

    void this.sendNativeTempoMapUpdate(state).catch((error) => {
      this.setNativeRuntimeStatus('tempo-map-update-failed', [], error)
      this.runtimeController?.fail(error)
    })
  }

  private submitNativeClipStop(clipId: string): void {
    if (!this.runtimeController || !this.model || !this.latestClockState?.running) return
    if (!this.runtimeController.status.snapshot?.transport.playing) return

    void this.sendNativeClipStop(clipId, this.latestClockState).catch((error) => {
      this.setNativeRuntimeStatus('clip-stop-failed', [], error)
      this.runtimeController?.fail(error)
    })
  }

  private async sendNativeClipStop(
    clipId: string,
    state: ClockState
  ): Promise<void> {
    if (!this.runtimeController || !this.model) return

    const snapshot = await this.runtimeController.refreshSnapshot()
    const atSample = snapshot?.transport.samplePosition ?? 0
    const commands = nativeClipImmediateNoteOffCommands(this.model, {
      clipId,
      beat: state.beat,
      atSample,
      timeMs: nowMs()
    })

    if (commands.length === 0) return

    this.setNativeRuntimeStatus(
      'clip-stop-release',
      commands.map((command) => command.type)
    )
    this.runtimeController.sendCommands(commands)
  }

  private async sendNativeTempoMapUpdate(state: ClockState): Promise<void> {
    if (!this.runtimeController || !this.model) return

    const snapshot = await this.runtimeController.refreshSnapshot()
    const sampleRate = snapshot?.stream.sampleRate || snapshot?.sampleRate || 48_000
    const currentSample = snapshot?.transport.samplePosition ?? 0
    const atSample = currentSample + nativeScheduleLeadSamples(sampleRate)
    const command = createNativeTempoMapCommand(this.model, {
      sampleRate,
      bpm: state.bpm,
      originSample: atSample,
      originBeat: this.nativeOriginBeatAtScheduledSample(snapshot, state, atSample),
      atSample,
      timeMs: nowMs()
    })

    this.setNativeRuntimeStatus('tempo-map-update', [command.type])
    this.runtimeController.sendCommands([command])
  }

  private async submitNativeClipSchedule(
    state: ClockState,
    mode: 'begin' | 'replace'
  ): Promise<number | undefined> {
    if (!this.runtimeController || !this.model) return

    const snapshot = await this.runtimeController.refreshSnapshot()
    const sampleRate = snapshot?.stream.sampleRate || snapshot?.sampleRate || 48_000
    const currentSample = snapshot?.transport.samplePosition ?? 0
    const atSample = currentSample + nativeScheduleLeadSamples(sampleRate)
    const originBeat = this.nativeOriginBeatAtScheduledSample(snapshot, state, atSample)
    const timeMs = nowMs()
    const clip = this.nativeScheduleClip()
    const submission = clip
      ? mode === 'replace'
        ? this.nativeClipScheduleSubmissions.replace(clip.id)
        : this.nativeClipScheduleSubmissions.begin(clip.id)
      : mode === 'replace'
        ? this.nativeClipScheduleSubmissions.clear()
        : undefined

    if (submission === undefined) return undefined

    const commands: EngineCommand[] = submission.invalidations.map((generation) =>
      nativeScheduledEventOwnerGenerationCommand(generation, {
        atSample,
        timeMs
      })
    )

    if (clip && submission.active) {
      const schedule = compileNativeClipSchedule(this.model, {
        clipId: clip.id,
        generation: submission.active.generation
      })

      commands.push(
        nativeScheduledEventOwnerGenerationCommand(submission.active, {
          atSample,
          timeMs
        }),
        createNativeTempoMapCommand(this.model, {
          sampleRate,
          bpm: state.bpm,
          originSample: atSample,
          originBeat,
          atSample,
          timeMs
        }),
        createNativeTransportLoopCommand({
          clip,
          bpm: state.bpm,
          sampleRate,
          originSample: atSample,
          originBeat,
          atSample,
          timeMs
        })
      )

      if (schedule.events.length > 0) {
        commands.push(
          nativeClipScheduleBatchCommand(schedule, {
            atSample,
            timeMs
          })
        )
      }
    }

    if (commands.length === 0) return atSample

    this.setNativeRuntimeStatus(
      `clip-schedule-${mode}`,
      commands.map((command) => command.type)
    )
    this.runtimeController.sendCommands(commands)
    return atSample
  }

  private nativeOriginBeatAtScheduledSample(
    snapshot: RuntimeSnapshot | undefined,
    state: ClockState,
    atSample: number
  ): number {
    const currentBeat = snapshot?.transport.beatPosition ?? state.beat

    if (!snapshot?.transport.playing) {
      return currentBeat
    }

    const sampleRate = snapshot.stream.sampleRate || snapshot.sampleRate || 48_000
    const leadSamples = atSample - snapshot.transport.samplePosition

    return currentBeat + (Math.max(0, leadSamples) * Math.max(1, state.bpm)) / (60 * Math.max(1, sampleRate))
  }

  private nativeScheduleClip(): PlaybackModel['clips'][number] | undefined {
    if (!this.model) return undefined

    const activeLaunches = Object.values(this.liveClips.state.activeClipByTrackId)

    if (activeLaunches.length > 0) {
      for (const launch of activeLaunches) {
        const clip = this.model.clips.find(
          (candidate) =>
            candidate.trackId === launch.trackId &&
            playbackClipMatchesLaunch(candidate.id, launch.clipId)
        )

        if (clip) return clip
      }

      return undefined
    }

    return this.model.clips[0]
  }

  private nativeActiveClips(
    playbackModel: PlaybackModel
  ): PlaybackModel['clips'][number][] {
    const activeLaunches = Object.values(this.liveClips.state.activeClipByTrackId)

    if (activeLaunches.length > 0) {
      return activeLaunches.flatMap((launch) =>
        playbackModel.clips.filter(
          (candidate) =>
            candidate.trackId === launch.trackId &&
            playbackClipMatchesLaunch(candidate.id, launch.clipId)
        )
      )
    }

    return playbackModel.clips.slice(0, 1)
  }

  private setNativeRuntimeStatus(
    lastAction: string,
    lastCommandTypes: readonly string[] = this.nativeRuntimeStatus.lastCommandTypes,
    error?: unknown
  ): void {
    this.nativeRuntimeStatus = {
      lastAction,
      lastCommandTypes: [...lastCommandTypes],
      lastError: error === undefined ? undefined : runtimeErrorMessage(error)
    }
    this.emitStatus()
  }

  private async initialiseOutputs(): Promise<void> {
    if (this.outputManager.registry.outputs().length > 0) return

    await this.outputManager.register(new ConsoleOutput())
    await this.outputManager.register(new MidiOutputStub(), false)
    await this.outputManager.register(this.webAudioOutput, false)
    await this.outputManager.register(this.webMidiOutput, false)
    await this.outputManager.register(new EventLoggerOutput(), false)
    await this.outputManager.register(this.statisticsOutput)
  }

  private async initialiseDevices(): Promise<void> {
    this.deviceManager.register(new ArpeggiatorFactory<PlaybackEvent>())
    this.deviceManager.register(new BasicSynthFactory<PlaybackEvent>())
    this.deviceManager.register(new DelayFactory<PlaybackEvent>())
    this.deviceManager.register(new ExternalMidiFactory<PlaybackEvent>())
    this.deviceManager.register(new LfoFactory<PlaybackEvent>())
    this.deviceManager.register(new SamplerFactory<PlaybackEvent>())
    await this.rebuildRuntimeDevices()
  }

  private async rebuildRuntimeDevices(): Promise<void> {
    if (!this.context) return

    if (this.deviceManager.status.runtimeDeviceCount > 0) {
      this.panicRuntimeVoices()
    }
    await this.deviceManager.disconnectAll()
    this.deviceManager.buildFromInstances(
      this.context.documentStore.document.deviceInstances.values()
    )
    if (this.model) {
      this.deviceManager.configureTrackDeviceChains(this.model.tracks)
    }
    await this.deviceManager.connectAll()
    this.syncRuntimeParametersToWebAudio()
    this.emitStatus()
  }

  private async rebuildRuntimeDevicesAndModel(): Promise<void> {
    await this.rebuildRuntimeDevices()
    this.rebuildModel()
  }

  private syncBasicSynthRuntimeParametersToWebAudio(): void {
    if (!this.context) return

    for (const track of this.context.documentStore.document.tracks.values()) {
      const deviceId = deviceIdsForTrack(track).find((candidateId) => {
        const candidate = this.deviceManager.runtimeDevices.find(candidateId)

        return candidate?.descriptorKey === 'basic-synth'
      })

      if (!deviceId) continue

      const device = this.deviceManager.runtimeDevices.find(deviceId)

      if (!device || device.descriptorKey !== 'basic-synth') continue

      this.webAudioOutput.setTrackSettings(track.id, {
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

  private syncDelayRuntimeParametersToWebAudio(): void {
    if (!this.context) return

    for (const track of this.context.documentStore.document.tracks.values()) {
      const deviceId = deviceIdsForTrack(track).find((candidateId) => {
        const candidate = this.deviceManager.runtimeDevices.find(candidateId)

        return candidate?.descriptorKey === 'delay'
      })
      const device = deviceId
        ? this.deviceManager.runtimeDevices.find(deviceId)
        : undefined

      if (!device || device.descriptorKey !== 'delay') {
        this.webAudioOutput.setTrackDelaySettings(track.id, undefined)
        continue
      }

      this.webAudioOutput.setTrackDelaySettings(track.id, {
        time: normalizeRuntimeDelayTime(
          getRuntimeParameterEffectiveValue(device.parameters, 'time'),
          getRuntimeParameterEffectiveValue(device.parameters, 'timeMode'),
          getRuntimeParameterEffectiveValue(device.parameters, 'syncDivision'),
          this.runtimeBpm ?? this.context.documentStore.document.bpm
        ),
        feedback: normalizeRuntimeDelayFeedback(
          getRuntimeParameterEffectiveValue(device.parameters, 'feedback')
        ),
        mix: normalizeRuntimeDelayMix(
          getRuntimeParameterEffectiveValue(device.parameters, 'mix')
        )
      })
    }
  }

  private syncRuntimeParametersToWebAudio(): void {
    this.syncBasicSynthRuntimeParametersToWebAudio()
    this.syncDelayRuntimeParametersToWebAudio()
  }

  private syncTrackMixersToWebAudio(): void {
    if (!this.model) return

    this.webAudioOutput.setTrackMixers(
      Object.fromEntries(
        this.model.tracks.map((track) => [track.id, track.mixer])
      )
    )
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

    const values = [
      ...samplePlaybackAutomationValues(this.model, state.beat),
      ...this.sampleRuntimeDeviceParameterValues()
    ]

    this.context?.events.emit<readonly PlaybackRuntimeParameterValue[]>({
      type: 'playback:runtime-parameters',
      serviceId: this.id,
      payload: values
    })
  }

  private emitRuntimeSnapshot(): void {
    const snapshot = this.runtimeController?.status.snapshot

    if (!snapshot) return

    this.context?.events.emit({
      type: 'playback:runtime-snapshot',
      serviceId: this.id,
      payload: snapshot
    })
  }

  private sampleRuntimeDeviceParameterValues(): PlaybackRuntimeParameterValue[] {
    if (!this.model) return []

    const trackIdByDeviceInstanceId = new Map<string, string>()

    for (const track of this.model.tracks) {
      for (const deviceId of deviceIdsForTrack(track)) {
        trackIdByDeviceInstanceId.set(deviceId, track.id)
      }
    }

    return this.deviceManager.runtimeDevices.values().flatMap((device) => {
      const trackId = trackIdByDeviceInstanceId.get(device.instanceId)

      if (!trackId) return []

      return device.parameters.flatMap((parameter) => {
        const value = getRuntimeParameterEffectiveValue(
          device.parameters,
          parameter.key
        )

        if (typeof value !== 'number' || !Number.isFinite(value)) return []

        return [{
          parameterId: deviceParameterId(device.instanceId, parameter.key),
          parameterKey: parameter.key,
          deviceInstanceId: device.instanceId,
          trackId,
          value
        }]
      })
    })
  }

  private getTrackGraphDiagnostics(): PlaybackTrackGraphDiagnostics[] {
    if (!this.context || !this.model) return []

    const deviceInstances = this.context.documentStore.document.deviceInstances

    return this.model.tracks.flatMap((track) => {
      const fragments = deviceIdsForTrack(track).flatMap((deviceId) => {
        const device = deviceInstances.find(deviceId)
        const descriptor = device
          ? this.deviceManager.devices.findFactory(device.descriptorKey)?.descriptor
          : undefined

        if (!device || !descriptor?.graphPreset) return []

        return [{
          id: device.id,
          name: device.name,
          graph: descriptor.graphPreset
        }]
      })

      if (fragments.length === 0) return []

      const graph = this.trackGraphBuilder.build(
        buildDeviceChainGraph({
          id: `track.${track.id}.chain`,
          name: `${track.name} Chain`,
          fragments
        })
      )

      return [{
        trackId: track.id,
        trackName: track.name,
        graph: runtimeGraphDiagnostics(graph)
      }]
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

function runtimeGraphDiagnostics(
  graph: RuntimeAudioGraph
): PlaybackRuntimeGraphDiagnostics {
  return {
    presetId: graph.document.id,
    nodeCount: graph.nodes.length,
    connectionCount: graph.connections.length,
    latencySamples: graph.latencySamples,
    executionOrder: graph.executionOrder,
    diagnostics: graph.diagnostics,
    nodeDiagnostics: graph.nodeDiagnostics
  }
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

function normalizeRuntimeDelayTime(
  value: unknown,
  mode: unknown,
  division: unknown,
  bpm: number
): number {
  if (mode === 'sync') {
    return delayDivisionSeconds(
      typeof division === 'string' ? division : '1/8',
      bpm
    )
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.25

  return Math.min(2, Math.max(0, value))
}

function normalizeRuntimeDelayFeedback(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.25

  return Math.min(0.95, Math.max(0, value))
}

function normalizeRuntimeDelayMix(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.25

  return Math.min(1, Math.max(0, value))
}

function delayDivisionSeconds(division: string, bpm: number): number {
  const beatSeconds = 60 / Math.max(1, Number.isFinite(bpm) ? bpm : 120)
  const beats = delayDivisionBeats(division)

  return Math.min(2, Math.max(0, beatSeconds * beats))
}

function delayDivisionBeats(division: string): number {
  switch (division) {
    case '1/4':
      return 1
    case '1/4.':
      return 1.5
    case '1/4T':
      return 2 / 3
    case '1/8.':
      return 0.75
    case '1/8T':
      return 1 / 3
    case '1/16':
      return 0.25
    case '1/16.':
      return 0.375
    case '1/16T':
      return 1 / 6
    case '1/8':
    default:
      return 0.5
  }
}

function deviceIdsForTrack(track: {
  readonly deviceInstanceIds?: readonly string[]
  readonly deviceInstanceId?: string
  readonly deviceIds?: readonly string[]
  readonly deviceId?: string
}): readonly string[] {
  if (track.deviceInstanceIds && track.deviceInstanceIds.length > 0) {
    return track.deviceInstanceIds
  }

  if (track.deviceInstanceId) return [track.deviceInstanceId]

  if (track.deviceIds && track.deviceIds.length > 0) return track.deviceIds

  return track.deviceId ? [track.deviceId] : []
}

function deviceParameterId(deviceInstanceId: string, parameterKey: string): string {
  return `device:${deviceInstanceId}:${parameterKey}`
}

function isDeviceParameterOperation(
  operation: Operation
): operation is Operation & {
  readonly deviceInstanceId: string
  readonly parameterKey: string
} {
  return (
    operation.name === 'Set Device Parameter Value' &&
    'deviceInstanceId' in operation &&
    typeof operation.deviceInstanceId === 'string' &&
    'parameterKey' in operation &&
    typeof operation.parameterKey === 'string'
  )
}

function isTrackMixerOperation(operation: Operation): boolean {
  return operation.name === 'Set Track Mixer Value'
}

function isPlaybackModelOperation(operation: Operation): boolean {
  return [
    'Create Clip For Track',
    'Delete Clip',
    'Resize MIDI Clip',
    'Set MIDI Clip Loop',
    'Set MIDI Clip Loop Region',
    'Move Pattern Placement',
    'Resize Pattern Placement',
    'Set Pattern Placement Loop',
    'Set Pattern Placement Loop Count',
    'Set Pattern Placement Loop Region',
    'Set Groove',
    'Set Parameter Value',
    'Set Pattern Automation',
    'Create Note',
    'Create Notes',
    'Delete Note',
    'Delete Notes',
    'Move Note',
    'Move Notes',
    'Resize Note',
    'Resize Notes',
    'Set Note Velocity',
    'Set Note Probability',
    'Set Note Humanise Offsets',
    'Quantise Notes'
  ].includes(operation.name)
}

function playbackClipMatchesLaunch(
  playbackClipId: string,
  launchedClipId: string
): boolean {
  return (
    playbackClipId === launchedClipId ||
    playbackClipId === `${launchedClipId}:active` ||
    playbackClipId.startsWith(`${launchedClipId}:`)
  )
}

function nativeScheduleLeadSamples(sampleRate: number): number {
  return Math.max(
    MIN_NATIVE_SCHEDULE_LEAD_SAMPLES,
    Math.round(Math.max(1, sampleRate) * NATIVE_SCHEDULE_LEAD_SECONDS)
  )
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

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message

  return String(error)
}
