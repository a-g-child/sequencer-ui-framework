import type { DocumentObserver, Operation, Service, ServiceContext, ServiceEvent } from '@sequencer/core'
import { PlaybackModelBuilder } from './builder'
import type { ClockState } from './clock'
import type { PlaybackEvent } from './events'
import {
  LiveClipService,
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
  readonly statistics: PlaybackOutputStatistics
  readonly webAudio: {
    readonly defaultSettings: WebAudioOscillatorSettings
    readonly trackSettings: Readonly<Record<string, WebAudioOscillatorSettings>>
  }
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
    this.rebuildModel()
    this.emitStatus()
  }

  async shutdown(): Promise<void> {
    this.scheduler.stop()
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
      statistics: this.statisticsOutput.statistics,
      webAudio: this.webAudioOutput.settings
    }
  }

  onCommandExecuted(_operation: Operation): void {
    this.rebuildModel()
  }

  onCommandUndone(_operation: Operation): void {
    this.rebuildModel()
  }

  onCommandRedone(_operation: Operation): void {
    this.rebuildModel()
  }

  requestClipLaunch(
    trackId: string,
    clipId: string,
    launchQuantize: ClipLaunchQuantize | number = this.liveClips.state.launchQuantizeBeats
  ): void {
    this.liveClips.requestLaunch(
      trackId,
      clipId,
      this.latestClockState ?? this.createStoppedClockState(),
      launchQuantize
    )
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
    this.liveClips.clearActiveClip(trackId)
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

  private handleServiceEvent(event: ServiceEvent): void {
    if (event.serviceId === this.id) return

    if (event.type === 'clock:started') {
      const state = event.payload as ClockState
      this.latestClockState = state
      this.runtimeBpm = state.bpm
      this.liveClips.applyDueLaunches(state)
      this.rebuildModel()
      this.scheduler.start(state.beat)
      this.emitStatus()
    }

    if (event.type === 'clock:stopped') {
      this.latestClockState = event.payload as ClockState
      this.scheduler.stop()
      this.outputManager.panic()
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
      this.latestClockState = state

      if (this.liveClips.applyDueLaunches(state)) {
        this.rebuildModel()
      }

      const events = this.scheduler.tick(state)
      const dispatchTimeMs = nowMs()

      this.statisticsOutput.recordSchedulerFrame({
        clockTimeMs: state.timeMs,
        dispatchTimeMs,
        events,
        schedulerStatus: this.status
      })
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
