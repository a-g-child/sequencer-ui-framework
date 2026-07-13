<script lang="ts">
  import { onMount } from 'svelte'
  import {
    SequencerApplication,
    createDeviceInstance,
    deserializeDocument,
    serializeDocument,
    validateDocument,
    type SelectionItem,
    type ServiceEvent,
    type ParameterValue,
    type Pattern,
    type Track,
    type TrackMixerState,
    type GrooveSettings
  } from '@sequencer/core'
  import {
    BrowserSocketNativeRuntimeTransport,
    ClockService,
    RendererNativeRuntimeTransport,
    PlaybackService,
    PlaybackRuntimeController,
    type ClockServiceStatus,
    type ClipLaunchQuantize,
    createRuntimeBackend,
    type NativeRuntimeTransport,
    type PlaybackDeviceDiagnostics,
    type PlaybackEvent,
    type PlaybackRuntimeParameterValue,
    type PlaybackServiceStatus,
    type RuntimeBackendKind,
    type NativeAudioDriver
  } from '@sequencer/playback'
  import {
    ARPEGGIATOR_DESCRIPTOR,
    BASIC_SYNTH_DESCRIPTOR,
    DELAY_DESCRIPTOR,
    EXTERNAL_MIDI_DESCRIPTOR,
    LFO_DESCRIPTOR,
    SAMPLER_DESCRIPTOR,
    type DeviceDescriptor,
    type DeviceInstance,
    type DeviceParameterDescriptor,
    type DeviceParameterValue,
    type SampleSlot,
    type SamplerDeviceInstance
  } from '@sequencer/device'
  import type { AssetReference } from '@sequencer/assets'
  import { AppController, type TrackClipView } from './lib/app-controller'
  import {
    buildInspectorView,
    type ClipInspectorView,
    type GraphDiagnosticsView,
    type InspectorPropertyView,
    type InspectorView
  } from './lib/inspector/inspector-model'
  import {
    buildTimelineView,
    type TimelinePlacementView,
    type TimelineView
  } from './lib/timeline/timeline-model'
  import {
    buildPianoRollView,
    type PianoRollView
  } from './lib/editors/piano-roll/piano-roll-model'
  import type { EditorKind } from './lib/editors/editor-types';
  import PatternEditor from './lib/music/pattern/PatternEditor.svelte';
  import type { SampleGridLane } from './lib/music/pattern/pattern-renderer';
  import {
    buildPatternAutomationTargets,
    deviceAutomationTargetId
  } from './lib/music/pattern/pattern-automation';
  import {
    defaultScaleState,
    type PatternScaleMode,
    type PatternScaleState
  } from './lib/music/pattern/pattern-scale';
  import Workbench from './lib/framework/application/Workbench.svelte';
  import InspectorPanel from './lib/panels/InspectorPanel.svelte';
  import RuntimePanel from './lib/panels/RuntimePanel.svelte';
  import TransportPanel from './lib/panels/TransportPanel.svelte';
  import MatrixView from './lib/matrix/MatrixView.svelte';
  import type {
    MatrixClipView,
    MatrixSceneRow,
    MatrixTrackView
  } from './lib/matrix/matrix-view-model';
  import TrackModules from './lib/modules/TrackModules.svelte';
  import { BrowserAssetStore } from './lib/persistence/BrowserAssetStore';
  import { LocalProjectStore } from './lib/persistence/LocalProjectStore';
  import {
    QuantizeNotesOperation,
    SetNoteHumanizeOffsetsOperation
  } from '@sequencer/music';

  type MainViewMode = 'matrix' | 'editor'
  type ClipCopyMode = 'idle' | 'select-source' | 'select-target'
  type SelectableDeviceKind = 'basic-synth' | 'sampler'
  type SelectableMidiDeviceKind = 'arpeggiator' | 'lfo'
  type SelectableAudioEffectKind = 'delay'
  type RuntimeSnapshot = NonNullable<
    NonNullable<PlaybackServiceStatus['runtime']>['snapshot']
  >
  type RuntimePlayheadAnchor = {
    beatPosition: number
    samplePosition: number
    sampleRate: number
    observedAtMs: number
    playing: boolean
  }

  type RuntimeTransportStatus =
    | { state: 'stopped' }
    | { state: 'starting' }
    | { state: 'playing'; snapshot: RuntimeSnapshot }
    | { state: 'stopping'; snapshot?: RuntimeSnapshot }
    | { state: 'failed'; message: string }

  type DeviceParameterView = {
    device: DeviceInstance
    descriptor: DeviceParameterDescriptor
    value: DeviceParameterValue
    runtimeValue?: DeviceParameterValue
    automated?: boolean
  }

  type SamplerSlotView = SampleSlot & {
    loaded: boolean
    label: string
  }

  type LfoModulationTargetOption = {
    id: string
    deviceId: string
    parameterKey: string
    label: string
  }

  const SAMPLER_SLOT_COUNT = 16
  const DEFAULT_SAMPLER_ROOT_NOTES = [
    36, 37, 38, 39,
    40, 41, 42, 43,
    44, 45, 46, 47,
    48, 49, 50, 51
  ]
  const MATRIX_SCENE_ROW_COUNT = 8
  const EDITOR_HUMANIZE_RANGE = 0.06

  const DEVICE_DESCRIPTORS: DeviceDescriptor[] = [
    ARPEGGIATOR_DESCRIPTOR,
    BASIC_SYNTH_DESCRIPTOR,
    DELAY_DESCRIPTOR,
    EXTERNAL_MIDI_DESCRIPTOR,
    LFO_DESCRIPTOR,
    SAMPLER_DESCRIPTOR
  ]
  const DEVICE_DESCRIPTORS_BY_KEY = new Map(
    DEVICE_DESCRIPTORS.map((descriptor) => [descriptor.key, descriptor])
  )

  const nativeBackendAvailable = canCreateNativeRuntimeTransport()
  const playbackBackendKind = resolveAvailablePlaybackBackendKind()
  const runtimeController =
    playbackBackendKind === 'native'
      ? new PlaybackRuntimeController(
          createRuntimeBackend({
            kind: 'native',
            native: {
              transport: createNativeRuntimeTransport(),
              audio: {
                driver: resolveNativeAudioDriver(),
                sampleRate: 48_000,
                bufferFrames: 128,
                channels: 2
              }
            }
          })
        )
      : undefined

  const app = new SequencerApplication()
  const clock = app.services.add(new ClockService())
  const playback = app.services.add(
    new PlaybackService(undefined, runtimeController)
  )
  const controller = new AppController(app)
  const store = app.documentStore
  const localProjectStore = new LocalProjectStore()
	  const browserAssetStore = new BrowserAssetStore()
	  const runtimeVisualFrameMs = 1000 / 30
  const launchQuantizeOptions: Array<{
    id: ClipLaunchQuantize
    label: string
  }> = [
    { id: 'none', label: 'None' },
    { id: 'beat', label: 'Beat' },
    { id: 'bar', label: 'Bar' },
    { id: '2-bars', label: '2 Bars' },
    { id: '4-bars', label: '4 Bars' }
  ]
  controller.selectInitialTrack()
	  onMount(() => {
	    const unsubscribeServices = app.serviceEvents.subscribe(handleServiceEvent)
    const unsubscribeDocument = store.events.subscribe((event) => {
      if (
        event.type === 'operation:executed' ||
        event.type === 'operation:undone' ||
        event.type === 'operation:redone'
      ) {
        projectPersistenceStatus = 'Unsaved changes'
      }
	    })
	    const runtimeVisualTimer = setInterval(() => {
	      runtimeVisualNowMs = nowMs()
	    }, runtimeVisualFrameMs)
	    void app.initialise()

	    return () => {
	      unsubscribeServices()
	      unsubscribeDocument()
	      clearInterval(runtimeVisualTimer)
	      void app.shutdown()
	    }
	  })

  let tracks = store.document.tracks.values()
  let selected: SelectionItem | undefined = store.selection.current()
  let selectedTrackId = selected?.type === 'track' ? selected.id : ''
  let inspector: InspectorView = buildInspectorView(store)
  let timeline: TimelineView = buildTimelineView(store)
  let activePattern: Pattern | undefined = store.document.patterns.values()[0]
  let activeClipId: string | undefined = controller.clipIdForPattern(
    activePattern?.id
  )
  let activePatternTrack: Track | undefined = findTrackForPattern(activePattern)
  let pianoRoll: PianoRollView | undefined = activePattern
    ? buildPianoRollView(activePattern)
    : undefined
  let automationTargets = buildPatternAutomationTargets(
    buildTrackParameterViews(activePatternTrack),
    buildSelectedTrackAutomationParameterViews(
      activePatternTrack,
      {},
      new Set<string>(),
      activePattern?.id
    )
  )
  let activePatternClipLoop = activeClipId
    ? store.document.midiClips.find(activeClipId)?.loopEnabled ?? true
    : controller.isPatternClipLooping(activePattern?.id)
  let activePatternClipLoopRegion = activeClipId
    ? controller.midiClipLoopRegion(activeClipId)
    : controller.patternClipLoopRegion(activePattern?.id)
  let draftName = inspector.type === 'track' ? inspector.title : ''
  let numberDrafts: Record<string, number> = {}
	  let transportPlaying = app.editorTransport.playing
	  let transportBpm = app.editorTransport.bpm
	  let transportBeat = app.editorTransport.currentBeat
	  let runtimeVisualNowMs = nowMs()
	  let runtimePlayheadAnchor: RuntimePlayheadAnchor | undefined
	  let runtimeTransportStatus: RuntimeTransportStatus = { state: 'stopped' }
  let groove: GrooveSettings = store.document.groove
  let audioEngineStatus = 'idle'
  let midiStatus = 'idle'
  let preferencesStatus = 'not loaded'
  let clockStatus: ClockServiceStatus = clock.status
  let playbackStatus: PlaybackServiceStatus = playback.status
  let samplerSampleStatus = ''
  let projectPersistenceStatus = 'Unsaved'
  let lastProjectSavedAt: Date | undefined
  let selectedSamplerSlotId = 'slot-1'
  let diagnosticsOpen = false
  let runtimeParameterValues: Record<string, ParameterValue> = {}
  let automatedRuntimeParameterIds = new Set<string>()
  let renderModelRebuildMs = 0
  let issues = validateDocument(store.document)
  let canUndo = store.history.canUndo()
  let canRedo = store.history.canRedo()
  let selectedTrackClips: TrackClipView[] = controller.trackClips(
    selectedTrackId,
    activeClipId,
    playbackStatus.liveClips.activeClipByTrackId[selectedTrackId]?.clipId,
    playbackStatus.liveClips.pendingLaunchByTrackId[selectedTrackId]
  )
  let matrixTracks: MatrixTrackView[] = buildMatrixTracks()
  let matrixSceneRows: MatrixSceneRow[] = buildMatrixSceneRows(matrixTracks)
  let activeEditor: EditorKind = 'piano-roll';
  let viewMode: MainViewMode = 'matrix'
  let clipCopyMode: ClipCopyMode = 'idle'
  let clipCopySource: TrackClipView | undefined
  let clipPressTimer: ReturnType<typeof setTimeout> | undefined
  let clipPressOpenedEditor = false
  let editorBeatDivisions = 4
  let showVelocityLane = false
  let showProbabilityLane = false
  let showAutomationLane = false
  let editorScale: PatternScaleState = { ...defaultScaleState }
	  $: syncRuntimeSnapshot(playbackStatus.runtime?.snapshot)
	  $: runtimeTransportStatus = buildRuntimeTransportStatus(playbackStatus)
	  $: effectiveTransportPlaying = runtimeTransportPlaying(
	    runtimeTransportStatus,
	    transportPlaying
	  )
	  $: effectiveTransportBeat =
	    runtimePlayheadAnchor === undefined
	      ? transportBeat
	      : interpolatedRuntimeBeat(
	          runtimePlayheadAnchor,
	          runtimeVisualNowMs,
	          transportBpm
	        )
	  $: activePatternPlayheadBeat = localPlayheadBeat(
	    effectiveTransportPlaying,
	    effectiveTransportBeat,
	    activePatternClipLoop,
	    activePatternClipLoopRegion
	  )
  $: selectedTrack = tracks.find((track) => track.id === selectedTrackId)
  $: selectedTrackDeviceName = buildSelectedTrackDeviceName(selectedTrack)
  $: selectedTrackGraphDiagnostics =
    buildSelectedTrackGraphDiagnostics(selectedTrack, playbackStatus)
  $: displayedInspector = applyGraphDiagnosticsToInspector(
    viewMode === 'editor'
      ? buildActiveClipInspector()
      : applyRuntimeParameterValues(inspector, runtimeParameterValues),
    selectedTrackGraphDiagnostics
  )
  $: selectedTrackDeviceParameterViews =
    buildSelectedTrackDeviceParameterViews(
      selectedTrack,
      runtimeParameterValues,
      automatedRuntimeParameterIds,
      activePattern?.id
    )
  $: selectedTrackMidiDeviceParameterViews =
    buildSelectedTrackMidiDeviceParameterViews(
      selectedTrack,
      runtimeParameterValues,
      automatedRuntimeParameterIds,
      activePattern?.id
    )
  $: selectedTrackLfoParameterViews =
    buildSelectedTrackLfoParameterViews(
      selectedTrack,
      runtimeParameterValues,
      automatedRuntimeParameterIds,
      activePattern?.id
    )
  $: selectedTrackAudioEffectParameterViews =
    buildSelectedTrackAudioEffectParameterViews(
      selectedTrack,
      runtimeParameterValues,
      automatedRuntimeParameterIds,
      activePattern?.id
    )
  $: lfoModulationTargetOptions = buildLfoModulationTargetOptions(selectedTrack)
  function rebuildInspector() {
    selected = store.selection.current()
    selectedTrackId = selected?.type === 'track' ? selected.id : ''
    inspector = buildInspectorView(store)
    draftName = inspector.type === 'track' ? inspector.title : ''
  }

  function syncView() {
    tracks = store.document.tracks.values()
    timeline = buildTimelineView(store)
    rebuildInspector()
    activeClipId = resolveActiveClipId(activeClipId)
    activePattern =
      findPatternForClip(activeClipId) ??
      (activePattern
        ? store.document.patterns.find(activePattern.id)
        : store.document.patterns.values()[0])
    activePatternTrack = findTrackForPattern(activePattern)
    pianoRoll = activePattern ? buildPianoRollView(activePattern) : undefined
    automationTargets = buildPatternAutomationTargets(
      buildTrackParameterViews(activePatternTrack),
      buildSelectedTrackAutomationParameterViews(
        activePatternTrack,
        runtimeParameterValues,
        automatedRuntimeParameterIds,
        activePattern?.id
      )
    )
    activePatternClipLoop = activeClipId
      ? store.document.midiClips.find(activeClipId)?.loopEnabled ?? true
      : controller.isPatternClipLooping(activePattern?.id)
    activePatternClipLoopRegion = activeClipId
      ? controller.midiClipLoopRegion(activeClipId)
      : controller.patternClipLoopRegion(activePattern?.id)
    groove = store.document.groove
    selectedTrackClips = controller.trackClips(
      selectedTrackId,
      activeClipId,
      playbackStatus.liveClips.activeClipByTrackId[selectedTrackId]?.clipId,
      playbackStatus.liveClips.pendingLaunchByTrackId[selectedTrackId]
    )
    refreshMatrixTracks()
    issues = validateDocument(store.document)
    canUndo = store.history.canUndo()
    canRedo = store.history.canRedo()
  }

  function handleServiceEvent(event: ServiceEvent) {
    if (event.type === 'transport:playing-changed') {
      const payload = event.payload as { playing?: boolean } | undefined
      transportPlaying = payload?.playing ?? false
    }

    if (event.type === 'transport:tempo-changed') {
      const payload = event.payload as { bpm?: number } | undefined
      transportBpm = payload?.bpm ?? transportBpm
    }

    if (event.type === 'transport:beat-changed') {
      const payload = event.payload as { currentBeat?: number } | undefined
      transportBeat = payload?.currentBeat ?? transportBeat
      refreshMatrixTracks()
    }

    if (event.type === 'clock:tempo-changed') {
      const payload = event.payload as { bpm?: number } | undefined
      transportBpm = payload?.bpm ?? transportBpm
    }

    if (event.type === 'clock:stopped') {
      runtimeParameterValues = {}
      automatedRuntimeParameterIds = new Set()
      refreshMatrixTracks()
    }

    if (event.type === 'audio-engine:status-changed') {
      const payload = event.payload as { status?: string } | undefined
      audioEngineStatus = payload?.status ?? audioEngineStatus
    }

    if (event.type === 'audio-engine:playing-changed') {
      const payload = event.payload as { playing?: boolean } | undefined
      audioEngineStatus = payload?.playing ? 'playing' : 'idle'
    }

    if (event.type === 'midi:initialised') {
      midiStatus = 'idle'
    }

    if (event.type === 'midi:shutdown') {
      midiStatus = 'offline'
    }

    if (event.type === 'preferences:loaded') {
      preferencesStatus = 'loaded'
    }

	    if (event.type === 'clock:status-changed') {
	      clockStatus =
	        (event.payload as ClockServiceStatus | undefined) ?? clockStatus
	    }

	    if (event.type === 'playback:status-changed') {
	      playbackStatus =
	        (event.payload as PlaybackServiceStatus | undefined) ?? playbackStatus
	      syncRuntimeSnapshot(playbackStatus.runtime?.snapshot)
	      refreshSelectedTrackClips()
	      refreshMatrixTracks()
	    }

	    if (event.type === 'playback:runtime-snapshot') {
	      const snapshot = event.payload as RuntimeSnapshot | undefined

	      syncRuntimeSnapshot(snapshot)
	      playbackStatus = mergeRuntimeSnapshotIntoPlaybackStatus(
	        playbackStatus,
	        snapshot
	      )
	    }

    if (event.type === 'playback:runtime-parameters') {
      reflectRuntimeParameterValues(
        (event.payload as readonly PlaybackRuntimeParameterValue[] | undefined) ?? []
      )
    }
  }

	  function reflectRuntimeParameterValues(
    values: readonly PlaybackRuntimeParameterValue[]
  ) {
    const nextValues = { ...runtimeParameterValues }
    const nextAutomationIds = new Set(
      values
        .filter((value) => value.automated)
        .map((value) => value.parameterId)
    )

    for (const parameterId of automatedRuntimeParameterIds) {
      if (!nextAutomationIds.has(parameterId)) {
        delete nextValues[parameterId]
      }
    }

    for (const value of values) {
      nextValues[value.parameterId] = value.value
    }

    automatedRuntimeParameterIds = nextAutomationIds
	    runtimeParameterValues = nextValues
	  }

	  function syncRuntimeSnapshot(snapshot: RuntimeSnapshot | undefined): void {
	    if (!snapshot) return

	    runtimePlayheadAnchor = {
	      beatPosition: snapshot.transport.beatPosition,
	      samplePosition: snapshot.transport.samplePosition,
	      sampleRate: snapshot.stream.sampleRate,
	      observedAtMs: nowMs(),
	      playing: snapshot.transport.playing
	    }
	  }

	  function mergeRuntimeSnapshotIntoPlaybackStatus(
	    status: PlaybackServiceStatus,
	    snapshot: RuntimeSnapshot | undefined
	  ): PlaybackServiceStatus {
	    if (!snapshot || !status.runtime) return status

	    return {
	      ...status,
	      runtime: {
	        ...status.runtime,
	        snapshot,
	        commandPending:
	          snapshot.transport.playing !== status.runtime.requestedTransportPlaying
	      }
	    }
	  }

	  function buildRuntimeTransportStatus(
	    status: PlaybackServiceStatus
	  ): RuntimeTransportStatus {
	    const runtime = status.runtime

	    if (!runtime) return { state: 'stopped' }
	    if (runtime.commandPending && runtime.requestedTransportPlaying) {
	      return { state: 'starting' }
	    }
	    if (runtime.commandPending && !runtime.requestedTransportPlaying) {
	      return { state: 'stopping', snapshot: runtime.snapshot }
	    }
	    if (runtime.snapshot?.transport.playing) {
	      return { state: 'playing', snapshot: runtime.snapshot }
	    }
	    if (runtime.state === 'failed') {
	      return {
	        state: 'failed',
	        message: runtime.failure ?? 'Native runtime failed'
	      }
	    }

	    return { state: 'stopped' }
	  }

	  function runtimeTransportPlaying(
	    status: RuntimeTransportStatus,
	    fallback: boolean
	  ): boolean {
	    switch (status.state) {
	      case 'playing':
	      case 'starting':
	        return true
	      case 'stopping':
	      case 'stopped':
	      case 'failed':
	        return fallback
	      default:
	        return fallback
	    }
	  }

	  function interpolatedRuntimeBeat(
	    anchor: RuntimePlayheadAnchor,
	    now: number,
	    bpm: number
	  ): number {
	    if (!anchor.playing) return anchor.beatPosition

	    const elapsedSeconds = Math.max(0, now - anchor.observedAtMs) / 1000
	    const beatsPerSecond = Math.max(1, bpm) / 60

	    return anchor.beatPosition + elapsedSeconds * beatsPerSecond
	  }

  function refreshSelectedTrackClips() {
    selectedTrackClips = controller.trackClips(
      selectedTrackId,
      activeClipId,
      playbackStatus.liveClips.activeClipByTrackId[selectedTrackId]?.clipId,
      playbackStatus.liveClips.pendingLaunchByTrackId[selectedTrackId]
    )
  }

  function resolveAvailablePlaybackBackendKind(): RuntimeBackendKind {
    const requested = normalizePlaybackBackendKind(
      readDevelopmentSetting('sequencer.playbackBackend') ??
        import.meta.env.VITE_PLAYBACK_BACKEND
    )

    return requested === 'native' && !nativeBackendAvailable
      ? 'web-audio'
      : requested
  }

  function resolveNativeAudioDriver(): NativeAudioDriver {
    const value =
      readDevelopmentSetting('sequencer.nativeAudioDriver') ??
      import.meta.env.VITE_NATIVE_AUDIO_DRIVER

    return value === 'cpal' ? 'cpal' : 'null'
  }

  function normalizePlaybackBackendKind(value: unknown): RuntimeBackendKind {
    return value === 'native' ? 'native' : 'web-audio'
  }

  function setPlaybackBackendKind(kind: RuntimeBackendKind): void {
    if (kind === playbackBackendKind) return
    if (kind === 'native' && !nativeBackendAvailable) return

    writeDevelopmentSetting('sequencer.playbackBackend', kind)
    globalThis.location?.reload()
  }

  function readDevelopmentSetting(key: string): string | undefined {
    try {
      return localStorage.getItem(key) ?? undefined
    } catch {
      return undefined
    }
  }

  function writeDevelopmentSetting(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      return
    }
  }

  function hasNativeRuntimeBridge(): boolean {
    return Boolean((globalThis as { nativeRuntime?: unknown }).nativeRuntime)
  }

  function canCreateNativeRuntimeTransport(): boolean {
    return (
      hasNativeRuntimeBridge() ||
      Boolean(configuredNativeRuntimeSocketUrl()) ||
      Boolean(defaultSameOriginNativeRuntimeSocketUrl())
    )
  }

  function createNativeRuntimeTransport(): NativeRuntimeTransport {
    if (hasNativeRuntimeBridge()) {
      return new RendererNativeRuntimeTransport()
    }

    const socketUrl =
      configuredNativeRuntimeSocketUrl() ??
      defaultSameOriginNativeRuntimeSocketUrl()

    if (socketUrl) {
      const token = nativeRuntimeToken(socketUrl)

      if (!token) {
        throw new NativeRuntimeUnavailableError(
          'Native runtime token is required. Start npm run dev:native-runtime, then open the printed Vite dev URL with its real nativeToken value.'
        )
      }

      return new BrowserSocketNativeRuntimeTransport({
        url: socketUrl,
        token
      })
    }

    throw new NativeRuntimeUnavailableError(
      'Native playback requires the desktop bridge or local runtime server.'
    )
  }

  function configuredNativeRuntimeSocketUrl(): string | undefined {
    const value = import.meta.env.VITE_NATIVE_RUNTIME_WS

    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined
  }

  function defaultSameOriginNativeRuntimeSocketUrl(): string | undefined {
    if (import.meta.env.DEV && !nativeRuntimeSameOriginEnabled()) {
      return undefined
    }

    const location = globalThis.location

    if (!location?.host) {
      return undefined
    }

    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      return undefined
    }

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'

    return `${protocol}://${location.host}/native-runtime`
  }

  function nativeRuntimeSameOriginEnabled(): boolean {
    const value = import.meta.env.VITE_NATIVE_RUNTIME_SAME_ORIGIN

    return typeof value === 'string' && value.toLowerCase() === 'true'
  }

  function nativeRuntimeToken(socketUrl: string): string | undefined {
    return (
      nativeRuntimeTokenFromEnv() ??
      nativeRuntimeTokenFromSearch(globalThis.location?.search) ??
      nativeRuntimeTokenFromSearch(socketUrlSearch(socketUrl))
    )
  }

  function nativeRuntimeTokenFromEnv(): string | undefined {
    const value = import.meta.env.VITE_NATIVE_RUNTIME_TOKEN

    return normalizeNativeRuntimeToken(value)
  }

  function nativeRuntimeTokenFromSearch(search: string | undefined): string | undefined {
    if (!search) {
      return undefined
    }

    const token = new URLSearchParams(search).get('nativeToken')

    return normalizeNativeRuntimeToken(token)
  }

  function socketUrlSearch(socketUrl: string): string | undefined {
    try {
      return new URL(socketUrl).search
    } catch {
      return undefined
    }
  }

  function normalizeNativeRuntimeToken(value: string | null | undefined): string | undefined {
    if (typeof value !== 'string') {
      return undefined
    }

    const token = value.trim()

    if (
      token.length === 0 ||
      token === '<token>' ||
      token === '<token printed by dev:native-runtime>'
    ) {
      return undefined
    }

    return token
  }

  class NativeRuntimeUnavailableError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'NativeRuntimeUnavailableError'
    }
  }

  function refreshMatrixTracks() {
    matrixTracks = buildMatrixTracks()
    matrixSceneRows = buildMatrixSceneRows(matrixTracks)
  }

  function buildMatrixTracks(): MatrixTrackView[] {
    return tracks.map((track) => ({
      track,
      clips: matrixTrackClips(track.id),
      queuedLaunch: trackQueuedLaunch(track.id)
    }))
  }

  function buildMatrixSceneRows(
    matrixTracks: MatrixTrackView[]
  ): MatrixSceneRow[] {
    const highestSlotIndex = Math.max(
      MATRIX_SCENE_ROW_COUNT - 1,
      ...matrixTracks.flatMap((track) =>
        track.clips.map((clip) => clip.slotIndex)
      )
    )

    return Array.from({ length: highestSlotIndex + 1 }, (_, slotIndex) => {
      const clips = matrixTracks.flatMap((track) =>
        track.clips.filter((clip) => clip.slotIndex === slotIndex)
      )

      return {
        slotIndex,
        label: `Scene ${slotIndex + 1}`,
        hasClips: clips.length > 0,
        playing: clips.some((clip) => clip.playbackActive),
        queued: clips.some((clip) => clip.pendingLaunch)
      }
    })
  }

  function applyRuntimeParameterValues(
    view: InspectorView,
    values: Record<string, ParameterValue>
  ): InspectorView {
    if (view.properties.length === 0) return view

    return {
      ...view,
      properties: view.properties.map((property) => {
        const value = values[property.parameter.id]

        if (value === undefined) return property

        return {
          ...property,
          parameter: {
            ...property.parameter,
            value
          },
          value
        }
      })
    }
  }

  function applyGraphDiagnosticsToInspector(
    view: InspectorView,
    graph: GraphDiagnosticsView | undefined
  ): InspectorView {
    if (view.type !== 'track') return view

    return {
      ...view,
      graph
    }
  }

  function buildActiveClipInspector(): InspectorView {
    const clip = activeClipId
      ? store.document.midiClips.find(activeClipId)
      : activePattern
        ? store.document.midiClips
            .values()
            .find((candidate) => candidate.pattern === activePattern?.id)
        : undefined
    const track = clip ? findTrackForClip(clip.id) : activePatternTrack

    if (!clip || !track) {
      return {
        type: 'none',
        title: 'No clip selected',
        properties: []
      }
    }

    const activeLaunch = playbackStatus.liveClips.activeClipByTrackId[track.id]
    const pendingLaunch = playbackStatus.liveClips.pendingLaunchByTrackId[track.id]
    const clipRegion = activePatternClipLoopRegion
    const clipLaunchQuantize = playbackStatus.liveClips.launchQuantize
    const clipInspector: ClipInspectorView = {
      id: clip.id,
      name: clip.name,
      trackId: track.id,
      trackName: track.name,
      volume: track.mixer.volume,
      pan: track.mixer.pan,
      muted: track.mixer.mute,
      soloed: track.mixer.solo,
      armed: activeLaunch?.clipId === clip.id,
      pending: pendingLaunch?.clipId === clip.id,
      clipStart: clipRegion.clipStart,
      clipEnd: clipRegion.clipStart + clipRegion.clipLength,
      loopEnabled: activePatternClipLoop,
      loopStart: clipRegion.loopStart,
      loopEnd: clipRegion.loopStart + clipRegion.loopLength,
      beatDivisions: editorBeatDivisions,
      launchQuantize: clipLaunchQuantize,
      launchQuantizeLabel: launchQuantizeLabel(clipLaunchQuantize),
      selectedNoteCount: selectedEditorNoteIds().length,
      velocityLaneVisible: showVelocityLane,
      probabilityLaneVisible: showProbabilityLane,
      automationLaneVisible: showAutomationLane,
      automationTargetCount: automationTargets.length,
      scale: activeEditor === 'piano-roll' ? editorScale : undefined
    }

    return {
      type: 'clip',
      title: clip.name,
      properties: [],
      clip: clipInspector
    }
  }

  function formatPlaybackEvent(event: PlaybackEvent | undefined): string {
    if (!event) return 'none'

    if (event.type === 'note:on' || event.type === 'note:off') {
      return `${event.type} ${event.pitch}`
    }

    if (event.type === 'automation:set') {
      return `${event.type} ${event.value.toFixed(2)}`
    }

    return event.type
  }

  function findTrackForPattern(pattern: Pattern | undefined): Track | undefined {
    if (!pattern) return undefined

    return store.document.tracks.values().find((track) =>
      track.placements.some((placement) => placement.target === pattern.id) ||
      track.clips.some((slot) => {
        const clip = store.document.midiClips.find(slot.target)

        return clip?.pattern === pattern.id
      })
    )
  }

  function findPatternForClip(clipId: string | undefined): Pattern | undefined {
    const patternId = controller.patternIdForClip(clipId)

    return patternId ? store.document.patterns.find(patternId) : undefined
  }

  function findTrackForClip(clipId: string | undefined): Track | undefined {
    if (!clipId) return undefined

    return store.document.tracks.values().find((track) =>
      track.clips.some((slot) => slot.target === clipId)
    )
  }

  function resolveActiveClipId(
    currentClipId: string | undefined
  ): string | undefined {
    const selectedClips = controller.trackClips(
      selectedTrackId,
      currentClipId,
      playbackStatus.liveClips.activeClipByTrackId[selectedTrackId]?.clipId,
      playbackStatus.liveClips.pendingLaunchByTrackId[selectedTrackId]
    )

    if (selectedClips.some((clip) => clip.id === currentClipId)) {
      return currentClipId
    }

    if (
      selectedTrackId &&
      store.document.tracks.find(selectedTrackId)?.clips.length &&
      !playbackStatus.liveClips.activeClipByTrackId[selectedTrackId] &&
      !playbackStatus.liveClips.pendingLaunchByTrackId[selectedTrackId]
    ) {
      return undefined
    }

    if (selectedClips[0]) {
      return selectedClips[0].id
    }

    if (currentClipId && store.document.midiClips.find(currentClipId)) {
      return currentClipId
    }

    return store.document.midiClips.values()[0]?.id
  }

  function buildTrackParameterViews(track: Track | undefined) {
    if (!track) return []

    return track.parameters.map((parameterId) => {
      const parameter = store.document.parameters.get(parameterId)
      const definition = store.document.parameterDefinitions.get(
        parameter.definitionId
      )

      return {
        parameter,
        definition,
        value: parameter.value
      }
    })
  }

  function buildSelectedTrackDeviceName(track: Track | undefined): string {
    const device = findTrackDeviceInstance(track)

    if (!device) return 'No device'

    const descriptor = DEVICE_DESCRIPTORS_BY_KEY.get(device.descriptorKey)

    return descriptor?.name ?? device.name
  }

  function buildSelectedTrackGraphDiagnostics(
    track: Track | undefined,
    status: PlaybackServiceStatus
  ): GraphDiagnosticsView | undefined {
    const trackGraph = track
      ? status.trackGraphDiagnostics.find((entry) => entry.trackId === track.id)
      : undefined

    if (trackGraph) {
      return graphDiagnosticsViewFromRuntimeGraph(
        `${trackGraph.trackName} Chain`,
        trackGraph.graph
      )
    }

    const device = findTrackDeviceInstance(track)

    if (!device) return undefined

    const diagnostics = status.deviceDiagnostics.find(
      (entry) => entry.id === device.id
    )
    const graph = graphDiagnosticsFromDeviceDiagnostics(diagnostics)

    if (!graph) return undefined

    const descriptor = DEVICE_DESCRIPTORS_BY_KEY.get(device.descriptorKey)

    return graphDiagnosticsViewFromRuntimeGraph(descriptor?.name ?? device.name, graph)
  }

  function graphDiagnosticsViewFromRuntimeGraph(
    deviceName: string,
    graph: RuntimeGraphDiagnosticsLike
  ): GraphDiagnosticsView {
    return {
      deviceName,
      presetId: graph.presetId,
      nodeCount: graph.nodeCount,
      connectionCount: graph.connectionCount,
      latencySamples: graph.latencySamples,
      executionOrder: [...graph.executionOrder],
      nodeDiagnostics: graph.nodeDiagnostics.map((diagnostic) => ({
        nodeId: diagnostic.nodeId,
        descriptorId: diagnostic.descriptorId,
        executionIndex: diagnostic.executionIndex,
        lastProcessMs: diagnostic.lastProcessMs,
        averageProcessMs: diagnostic.averageProcessMs,
        peakProcessMs: diagnostic.peakProcessMs,
        latencySamples: diagnostic.latencySamples
      })),
      validationMessages: graph.diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message
      }))
    }
  }

  function graphDiagnosticsFromDeviceDiagnostics(
    diagnostics: PlaybackDeviceDiagnostics | undefined
  ): RuntimeGraphDiagnosticsLike | undefined {
    const candidate = diagnostics?.diagnostics

    if (!isRecord(candidate)) return undefined

    return isRuntimeGraphDiagnosticsLike(candidate.graph)
      ? candidate.graph
      : undefined
  }

  type RuntimeGraphDiagnosticsLike = {
    presetId: string
    nodeCount: number
    connectionCount: number
    latencySamples: number
    executionOrder: readonly string[]
    diagnostics: readonly {
      severity: string
      code: string
      message: string
    }[]
    nodeDiagnostics: readonly {
      nodeId: string
      descriptorId: string
      executionIndex: number
      lastProcessMs?: number
      averageProcessMs?: number
      peakProcessMs?: number
      latencySamples?: number
    }[]
  }

  function isRuntimeGraphDiagnosticsLike(
    value: unknown
  ): value is RuntimeGraphDiagnosticsLike {
    if (!isRecord(value)) return false

    return (
      typeof value.presetId === 'string' &&
      typeof value.nodeCount === 'number' &&
      typeof value.connectionCount === 'number' &&
      typeof value.latencySamples === 'number' &&
      Array.isArray(value.executionOrder) &&
      value.executionOrder.every((item) => typeof item === 'string') &&
      Array.isArray(value.diagnostics) &&
      value.diagnostics.every(isGraphDiagnosticMessageLike) &&
      Array.isArray(value.nodeDiagnostics) &&
      value.nodeDiagnostics.every(isRuntimeNodeDiagnosticsLike)
    )
  }

  function isRuntimeNodeDiagnosticsLike(value: unknown): value is {
    nodeId: string
    descriptorId: string
    executionIndex: number
    lastProcessMs?: number
    averageProcessMs?: number
    peakProcessMs?: number
    latencySamples?: number
  } {
    return (
      isRecord(value) &&
      typeof value.nodeId === 'string' &&
      typeof value.descriptorId === 'string' &&
      typeof value.executionIndex === 'number' &&
      optionalNumber(value.lastProcessMs) &&
      optionalNumber(value.averageProcessMs) &&
      optionalNumber(value.peakProcessMs) &&
      optionalNumber(value.latencySamples)
    )
  }

  function optionalNumber(value: unknown): boolean {
    return value === undefined || typeof value === 'number'
  }

  function isGraphDiagnosticMessageLike(value: unknown): value is {
    severity: string
    code: string
    message: string
  } {
    return (
      isRecord(value) &&
      typeof value.severity === 'string' &&
      typeof value.code === 'string' &&
      typeof value.message === 'string'
    )
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  function buildSelectedTrackDeviceParameterViews(
    track: Track | undefined,
    values: Record<string, ParameterValue>,
    automatedIds: Set<string>,
    patternId: string | undefined
  ): DeviceParameterView[] {
    const device = findTrackDeviceInstance(track)

    return buildDeviceParameterViews(device, values, automatedIds, patternId)
  }

  function buildSelectedTrackMidiDeviceParameterViews(
    track: Track | undefined,
    values: Record<string, ParameterValue>,
    automatedIds: Set<string>,
    patternId: string | undefined
  ): DeviceParameterView[] {
    const device = findTrackArpeggiatorDevice(track)

    return buildDeviceParameterViews(device, values, automatedIds, patternId)
  }

  function buildSelectedTrackLfoParameterViews(
    track: Track | undefined,
    values: Record<string, ParameterValue>,
    automatedIds: Set<string>,
    patternId: string | undefined
  ): DeviceParameterView[] {
    const device = findTrackLfoDevice(track)

    return buildDeviceParameterViews(device, values, automatedIds, patternId)
  }

  function buildSelectedTrackAudioEffectParameterViews(
    track: Track | undefined,
    values: Record<string, ParameterValue>,
    automatedIds: Set<string>,
    patternId: string | undefined
  ): DeviceParameterView[] {
    const device = findTrackDelayDevice(track)

    return buildDeviceParameterViews(device, values, automatedIds, patternId)
  }

  function buildSelectedTrackAutomationParameterViews(
    track: Track | undefined,
    values: Record<string, ParameterValue>,
    automatedIds: Set<string>,
    patternId: string | undefined
  ): DeviceParameterView[] {
    return [
      ...buildSelectedTrackMidiDeviceParameterViews(
        track,
        values,
        automatedIds,
        patternId
      ),
      ...buildSelectedTrackLfoParameterViews(
        track,
        values,
        automatedIds,
        patternId
      ),
      ...buildSelectedTrackDeviceParameterViews(
        track,
        values,
        automatedIds,
        patternId
      ),
      ...buildSelectedTrackAudioEffectParameterViews(
        track,
        values,
        automatedIds,
        patternId
      )
    ]
  }

  function buildDeviceParameterViews(
    device: DeviceInstance | undefined,
    values: Record<string, ParameterValue>,
    automatedIds: Set<string>,
    patternId: string | undefined
  ): DeviceParameterView[] {
    if (!device) return []

    const descriptor = DEVICE_DESCRIPTORS_BY_KEY.get(device.descriptorKey)

    if (!descriptor) return []

    return descriptor.parameters.map((parameter) => {
      const parameterId = deviceAutomationTargetId(device.id, parameter.key)
      const runtimeValue = values[parameterId]
      const hasDocumentAutomation = Boolean(
        patternId &&
        controller.patternAutomationPoints(patternId, parameterId).length > 0
      )

      return {
        device,
        descriptor: parameter,
        value: device.parameterValues[parameter.key] ?? parameter.defaultValue,
        runtimeValue,
        automated: automatedIds.has(parameterId) || hasDocumentAutomation
      }
    })
  }

  function selectedSamplerDevice(
    track: Track | undefined
  ): SamplerDeviceInstance | undefined {
    const device = findTrackDeviceInstance(track)

    return device?.descriptorKey === SAMPLER_DESCRIPTOR.key
      ? (device as SamplerDeviceInstance)
      : undefined
  }

  function selectedTrackDeviceKind(
    track: Track | undefined
  ): SelectableDeviceKind | undefined {
    const device = findTrackDeviceInstance(track)

    if (device?.descriptorKey === BASIC_SYNTH_DESCRIPTOR.key) return 'basic-synth'
    if (device?.descriptorKey === SAMPLER_DESCRIPTOR.key) return 'sampler'

    return undefined
  }

  function selectedTrackMidiDeviceKind(
    track: Track | undefined
  ): SelectableMidiDeviceKind | undefined {
    return findTrackArpeggiatorDevice(track) ? 'arpeggiator' : undefined
  }

  function selectedTrackHasLfo(track: Track | undefined): boolean {
    return Boolean(findTrackLfoDevice(track))
  }

  function selectedTrackAudioEffectKind(
    track: Track | undefined
  ): SelectableAudioEffectKind | undefined {
    return findTrackDelayDevice(track) ? 'delay' : undefined
  }

  function buildSelectedSamplerSampleName(track: Track | undefined): string {
    const slot = selectedSamplerSlot(track)

    if (!slot?.assetId) return 'No sample'

    return store.document.assets.find(slot.assetId)?.name ?? slot.name
  }

  function selectedSamplerSlot(track: Track | undefined): SamplerSlotView | undefined {
    return selectedSamplerSlots(track).find((slot) => slot.id === selectedSamplerSlotId)
  }

  function selectedSamplerSlots(track: Track | undefined): SamplerSlotView[] {
    const sampler = selectedSamplerDevice(track)
    const slotsById = new Map(
      (sampler?.sampleSlots ?? []).map((slot) => [slot.id, slot])
    )

    return Array.from({ length: SAMPLER_SLOT_COUNT }, (_, index) => {
      const fallback = defaultSamplerSlot(index)
      const slot = slotsById.get(fallback.id) ?? fallback

      return {
        ...fallback,
        ...slot,
        loaded: Boolean(slot.assetId),
        label: slot.assetId
          ? store.document.assets.find(slot.assetId)?.name ?? slot.name
          : fallback.name
      }
    })
  }

  function selectedSamplerGridLanes(track: Track | undefined): SampleGridLane[] {
    const sampler = selectedSamplerDevice(track)

    if (!sampler) return []

    return selectedSamplerSlots(track).map((slot) => ({
      pitch: slot.rootNote,
      label: slot.label
    }))
  }

  function defaultSamplerSlot(index: number): SampleSlot {
    const slotNumber = index + 1

    return {
      id: `slot-${slotNumber}`,
      name: `Slot ${slotNumber}`,
      rootNote:
        DEFAULT_SAMPLER_ROOT_NOTES[index] ??
        DEFAULT_SAMPLER_ROOT_NOTES.at(-1)! + index,
      gain: 1,
      start: 0,
      loop: false
    }
  }

  function findTrackDeviceInstance(
    track: Track | undefined
  ): DeviceInstance | undefined {
    const deviceId = deviceChainForTrack(track).find((candidateId) => {
      const device = store.document.deviceInstances.find(candidateId)
      const descriptor = device
        ? DEVICE_DESCRIPTORS_BY_KEY.get(device.descriptorKey)
        : undefined

      return descriptor?.capabilities.includes('instrument')
    }) ?? track?.deviceId

    if (!deviceId) return undefined

    return store.document.deviceInstances.find(deviceId)
  }

  function findTrackArpeggiatorDevice(
    track: Track | undefined
  ): DeviceInstance | undefined {
    for (const deviceId of deviceChainForTrack(track)) {
      const device = store.document.deviceInstances.find(deviceId)

      if (device?.descriptorKey === ARPEGGIATOR_DESCRIPTOR.key) return device
    }

    return undefined
  }

  function findTrackLfoDevice(
    track: Track | undefined
  ): DeviceInstance | undefined {
    for (const deviceId of deviceChainForTrack(track)) {
      const device = store.document.deviceInstances.find(deviceId)

      if (device?.descriptorKey === LFO_DESCRIPTOR.key) return device
    }

    return undefined
  }

  function findTrackDelayDevice(
    track: Track | undefined
  ): DeviceInstance | undefined {
    for (const deviceId of deviceChainForTrack(track)) {
      const device = store.document.deviceInstances.find(deviceId)

      if (device?.descriptorKey === DELAY_DESCRIPTOR.key) return device
    }

    return undefined
  }

  function buildLfoModulationTargetOptions(
    track: Track | undefined
  ): LfoModulationTargetOption[] {
    const options: LfoModulationTargetOption[] = []
    const lfo = findTrackLfoDevice(track)

    for (const deviceId of deviceChainForTrack(track)) {
      if (deviceId === lfo?.id) continue

      const device = store.document.deviceInstances.find(deviceId)
      const descriptor = device
        ? DEVICE_DESCRIPTORS_BY_KEY.get(device.descriptorKey)
        : undefined

      if (!device || !descriptor) continue
      if (!descriptor.capabilities.includes('automation-target')) continue

      for (const parameter of descriptor.parameters) {
        if (parameter.kind !== 'number') continue

        options.push({
          id: `${device.id}:${parameter.key}`,
          deviceId: device.id,
          parameterKey: parameter.key,
          label: `${device.name} / ${parameter.name}`
        })
      }
    }

    return options
  }

  function deviceChainForTrack(track: Track | undefined): string[] {
    if (!track) return []
    if (track.deviceIds && track.deviceIds.length > 0) return [...track.deviceIds]
    if (track.deviceId) return [track.deviceId]

    return []
  }

  function playTransport() {
    ensureSelectedClipActiveWhenStopped()
    void playback.setWebAudioEnabled(true)
    controller.playTransport()
  }

  function stopTransport() {
    controller.stopTransport()
  }

  function setRuntimeBpm(event: Event) {
    const bpm = readNumberValue(event)

    controller.setRuntimeBpm(bpm)
  }

  function setSwingAmount(amount: number) {
    if (!controller.setGrooveAmount(amount)) return

    syncView()
  }

  async function loadSamplerSampleFile(file: File) {
    if (!selectedTrack) return
    const selectedSlot =
      selectedSamplerSlot(selectedTrack) ?? defaultSamplerSlot(0)

    const assetId = `asset_${crypto.randomUUID()}`
    const runtimeUri = URL.createObjectURL(file)
    const asset: AssetReference = {
      id: assetId,
      kind: 'audio-sample',
      name: file.name,
      uri: browserAssetStore.uriFor(assetId),
      mimeType: file.type || undefined,
      sizeBytes: file.size
    }

    try {
      await browserAssetStore.saveFile(asset.id, file)
      const buffer = await playback.loadSampleAsset({
        ...asset,
        uri: runtimeUri
      })
      const loadedAsset: AssetReference = {
        ...asset,
        durationSeconds: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels
      }
      const sampler = selectedSamplerDevice(selectedTrack)

      if (!sampler) {
        samplerSampleStatus = 'Attach a sampler first'
        return
      }

      const slot: SampleSlot = {
        ...selectedSlot,
        name: file.name,
        assetId: loadedAsset.id,
        end: loadedAsset.durationSeconds,
      }

      controller.addAsset(loadedAsset)
      controller.setSamplerSampleSlot(sampler.id, slot)
      samplerSampleStatus = `${file.name} loaded`
      syncView()
      playbackStatus = playback.status
    } catch (error) {
      samplerSampleStatus =
        error instanceof Error ? error.message : 'Could not load sample'
    } finally {
      URL.revokeObjectURL(runtimeUri)
    }
  }

  function attachTrackDevice(kind: SelectableDeviceKind) {
    if (!selectedTrack) return undefined

    const descriptor =
      kind === 'sampler' ? SAMPLER_DESCRIPTOR : BASIC_SYNTH_DESCRIPTOR
    const device = createDeviceInstance(
      descriptor,
      descriptor.name
    ) as DeviceInstance

    if (kind === 'sampler') {
      device.parameterValues.mode = 'multi'
    }

    const nextChain = deviceChainWithInstrument(
      deviceChainForTrack(selectedTrack),
      device.id
    )

    controller.addDeviceInstance(device)
    controller.setTrackDeviceChain(selectedTrack.id, nextChain)
    selectedSamplerSlotId = 'slot-1'
    samplerSampleStatus = ''
    syncView()
  }

  function attachTrackMidiDevice(kind: SelectableMidiDeviceKind) {
    if (!selectedTrack) return undefined
    if (kind === 'arpeggiator' && findTrackArpeggiatorDevice(selectedTrack)) {
      return undefined
    }
    if (kind === 'lfo' && findTrackLfoDevice(selectedTrack)) {
      return undefined
    }

    const descriptor =
      kind === 'lfo' ? LFO_DESCRIPTOR : ARPEGGIATOR_DESCRIPTOR
    const device = createDeviceInstance(
      descriptor,
      descriptor.name
    ) as DeviceInstance
    const chain = deviceChainForTrack(selectedTrack)
    const firstInstrumentIndex = chain.findIndex((deviceId) => {
      const chainDevice = store.document.deviceInstances.find(deviceId)
      const chainDescriptor = chainDevice
        ? DEVICE_DESCRIPTORS_BY_KEY.get(chainDevice.descriptorKey)
        : undefined

      return chainDescriptor?.capabilities.includes('instrument')
    })
    const nextChain =
      firstInstrumentIndex === -1
        ? [...chain, device.id]
        : [
            ...chain.slice(0, firstInstrumentIndex),
            device.id,
            ...chain.slice(firstInstrumentIndex)
          ]

    controller.addDeviceInstance(device)
    controller.setTrackDeviceChain(selectedTrack.id, nextChain)
    syncView()
  }

  function removeTrackMidiDevice(kind: SelectableMidiDeviceKind) {
    if (!selectedTrack) return

    const midiDevice =
      kind === 'lfo'
        ? findTrackLfoDevice(selectedTrack)
        : findTrackArpeggiatorDevice(selectedTrack)

    if (!midiDevice) return

    const nextChain = deviceChainForTrack(selectedTrack).filter(
      (deviceId) => deviceId !== midiDevice.id
    )

    controller.setTrackDeviceChain(selectedTrack.id, nextChain)
    syncView()
  }

  function attachTrackAudioEffect(kind: SelectableAudioEffectKind) {
    if (!selectedTrack) return undefined
    if (kind !== 'delay') return undefined
    if (findTrackDelayDevice(selectedTrack)) return undefined

    const device = createDeviceInstance(
      DELAY_DESCRIPTOR,
      DELAY_DESCRIPTOR.name
    ) as DeviceInstance
    const nextChain = [...deviceChainForTrack(selectedTrack), device.id]

    controller.addDeviceInstance(device)
    controller.setTrackDeviceChain(selectedTrack.id, nextChain)
    syncView()
  }

  function removeTrackAudioEffect(kind: SelectableAudioEffectKind) {
    if (!selectedTrack) return
    if (kind !== 'delay') return

    const delay = findTrackDelayDevice(selectedTrack)

    if (!delay) return

    const nextChain = deviceChainForTrack(selectedTrack).filter(
      (deviceId) => deviceId !== delay.id
    )

    controller.setTrackDeviceChain(selectedTrack.id, nextChain)
    syncView()
  }

  function removeSelectedTrackDevice() {
    if (!selectedTrack) return

    const instrument = findTrackDeviceInstance(selectedTrack)

    if (!instrument) return

    controller.setTrackDeviceChain(selectedTrack.id, [])
    samplerSampleStatus = ''
    syncView()
  }

  function deviceChainWithInstrument(
    chain: readonly string[],
    instrumentId: string
  ): string[] {
    const withoutInstrument = chain.filter((deviceId) => {
      const device = store.document.deviceInstances.find(deviceId)
      const descriptor = device
        ? DEVICE_DESCRIPTORS_BY_KEY.get(device.descriptorKey)
        : undefined

      return !descriptor?.capabilities.includes('instrument')
    })
    const firstAudioEffectIndex = withoutInstrument.findIndex((deviceId) => {
      const device = store.document.deviceInstances.find(deviceId)
      const descriptor = device
        ? DEVICE_DESCRIPTORS_BY_KEY.get(device.descriptorKey)
        : undefined

      return descriptor?.capabilities.includes('audio-effect')
    })

    if (firstAudioEffectIndex === -1) {
      return [...withoutInstrument, instrumentId]
    }

    return [
      ...withoutInstrument.slice(0, firstAudioEffectIndex),
      instrumentId,
      ...withoutInstrument.slice(firstAudioEffectIndex)
    ]
  }

  function setDeviceParameterValue(
    deviceInstanceId: string,
    parameterKey: string,
    value: DeviceParameterValue
  ) {
    controller.setDeviceParameterValue(deviceInstanceId, parameterKey, value)
    syncView()
  }

  function setTrackMixerValue<K extends keyof TrackMixerState>(
    trackId: string,
    key: K,
    value: TrackMixerState[K]
  ) {
    if (!trackId) return

    controller.setTrackMixerValue(trackId, key, value)
    syncView()
  }

  function setSamplerSampleSlot(slot: SampleSlot) {
    const sampler = selectedSamplerDevice(selectedTrack)

    if (!sampler) return

    controller.setSamplerSampleSlot(sampler.id, slot)
    syncView()
  }

  function selectSamplerSlot(slotId: string) {
    selectedSamplerSlotId = slotId
  }

  function toggleDiagnosticsOverlay() {
    diagnosticsOpen = !diagnosticsOpen
  }

  function showMatrixView() {
    viewMode = 'matrix'
    endClipPress()
  }

  function toggleClipCopyMode() {
    endClipPress()

    if (clipCopyMode === 'idle') {
      clipCopyMode = 'select-source'
      clipCopySource = undefined
      return
    }

    clipCopyMode = 'idle'
    clipCopySource = undefined
  }

  function toggleActivePatternClipLoop(loop: boolean) {
    const changed = activeClipId
      ? controller.setMidiClipLoop(activeClipId, loop)
      : controller.setPatternClipLoop(activePattern?.id, loop)

    if (!changed) return
    syncView()
  }

  function setActivePatternClipLoopRegion(loopStart: number, loopLength: number) {
    const changed = activeClipId
      ? controller.setMidiClipLoopRegion(activeClipId, loopStart, loopLength)
      : controller.setPatternClipLoopRegion(
          activePattern?.id,
          loopStart,
          loopLength
        )

    if (!changed) return
    syncView()
  }

  function setActivePatternClipBounds(clipStart: number, clipLength: number) {
    const changed = activeClipId
      ? controller.setMidiClipBounds(activeClipId, clipLength)
      : controller.setPatternClipBounds(activePattern?.id, clipStart, clipLength)

    if (!changed) return
    syncView()
  }

  function setActivePatternClipEnd(clipEnd: number) {
    const clipStart = activePatternClipLoopRegion.clipStart

    setActivePatternClipBounds(clipStart, clipEnd - clipStart)
  }

  function setActivePatternClipLoopStart(loopStart: number) {
    const loopEnd =
      activePatternClipLoopRegion.loopStart +
      activePatternClipLoopRegion.loopLength

    setActivePatternClipLoopRegion(loopStart, loopEnd - loopStart)
  }

  function setActivePatternClipLoopEnd(loopEnd: number) {
    setActivePatternClipLoopRegion(
      activePatternClipLoopRegion.loopStart,
      loopEnd - activePatternClipLoopRegion.loopStart
    )
  }

  function setEditorBeatDivisions(value: number) {
    if (!Number.isFinite(value)) return

    editorBeatDivisions = Math.min(32, Math.max(1, Math.round(value)))
  }

  function setEditorScaleRoot(root: number) {
    editorScale = {
      ...editorScale,
      root: Math.min(11, Math.max(0, Math.round(root)))
    }
  }

  function setEditorScaleId(scaleId: string) {
    editorScale = {
      ...editorScale,
      scaleId
    }
  }

  function setEditorScaleMode(mode: PatternScaleMode) {
    editorScale = {
      ...editorScale,
      mode
    }
  }

  function armEditedClip() {
    const trackId = findTrackForClip(activeClipId)?.id ?? selectedTrackId

    if (!trackId || !activeClipId) return

    ensureClipActiveWhenStopped(trackId, activeClipId)
    syncView()
  }

  function quantizeEditorSelection() {
    const noteIds = selectedEditorNoteIds()

    if (!activePattern || noteIds.length === 0) return

    controller.execute(
      new QuantizeNotesOperation(activePattern.id, noteIds, 1 / editorBeatDivisions)
    )
    syncView()
  }

  function humanizeEditorSelection() {
    const noteIds = selectedEditorNoteIds()

    if (!activePattern || noteIds.length === 0) return

    const notes = pianoRoll?.notes.filter((note) => noteIds.includes(note.id)) ?? []

    if (notes.length === 0) return

    controller.execute(
      new SetNoteHumanizeOffsetsOperation(
        activePattern.id,
        notes.map((note) => ({
          id: note.id,
          offset: randomEditorHumanizeOffset(note.time)
        }))
      )
    )
    syncView()
  }

  function selectedEditorNoteIds(): string[] {
    const selection = store.selection.current()

    if (!selection || selection.type !== 'note' || !selection.parentId) return []
    if (activePattern && selection.parentId !== activePattern.id) return []

    return selection.ids?.length ? [...selection.ids] : [selection.id]
  }

  function randomEditorHumanizeOffset(noteTime: number): number {
    const offset = (Math.random() * 2 - 1) * EDITOR_HUMANIZE_RANGE

    return Math.max(-noteTime, offset)
  }

  function setRenderModelRebuildTime(durationMs: number) {
    renderModelRebuildMs = durationMs
  }

  function localPlayheadBeat(
    playing: boolean,
    beat: number,
    loopClip: boolean,
    region: { clipStart: number; clipLength: number; loopStart: number; loopLength: number }
  ): number | undefined {
    if (!playing || region.clipLength <= 0) return undefined

    const localBeat = beat - region.clipStart

    if (localBeat < 0) return undefined

    if (!loopClip || localBeat < region.loopStart || region.loopLength <= 0) {
      return localBeat <= region.clipLength ? localBeat : undefined
    }

    return region.loopStart + ((localBeat - region.loopStart) % region.loopLength)
  }

  function selectTrack(track: Track) {
    controller.selectTrack(track)
    if (viewMode === 'matrix') {
      activeClipId = undefined
    }
    syncView()
  }

  function selectClip(clip: TrackClipView) {
    activeClipId = clip.id
    ensureClipActiveWhenStopped(clip.trackId, clip.id)
    syncView()
  }

  function openClipEditor(clip: TrackClipView) {
    const track = tracks.find((item) => item.id === clip.trackId)

    if (track) {
      controller.selectTrack(track)
    }

    activeClipId = clip.id
    viewMode = 'editor'
    ensureClipActiveWhenStopped(clip.trackId, clip.id)
    syncView()
  }

  function ensureClipActiveWhenStopped(trackId: string, clipId: string) {
    if (transportPlaying) return
    if (playback.activeClipForTrack(trackId) === clipId) return

    playback.requestClipLaunch(trackId, clipId, 'none')
    playbackStatus = playback.status
    refreshSelectedTrackClips()
    refreshMatrixTracks()
  }

  function ensureSelectedClipActiveWhenStopped() {
    if (transportPlaying || !selectedTrackId || !activeClipId) return

    const selectedClip = controller
      .trackClips(
        selectedTrackId,
        activeClipId,
        playbackStatus.liveClips.activeClipByTrackId[selectedTrackId]?.clipId,
        playbackStatus.liveClips.pendingLaunchByTrackId[selectedTrackId]
      )
      .find((clip) => clip.id === activeClipId)

    if (!selectedClip) return

    ensureClipActiveWhenStopped(selectedTrackId, activeClipId)
  }

  function startClipPress(clip: TrackClipView) {
    if (clipCopyMode !== 'idle') return

    endClipPress()
    clipPressOpenedEditor = false
    clipPressTimer = setTimeout(() => {
      clipPressOpenedEditor = true
      openClipEditor(clip)
    }, 500)
  }

  function endClipPress() {
    if (!clipPressTimer) return

    clearTimeout(clipPressTimer)
    clipPressTimer = undefined
  }

  function launchMatrixClip(clip: TrackClipView) {
    if (clipCopyMode === 'select-source') {
      endClipPress()
      clipCopySource = clip
      clipCopyMode = 'select-target'
      return
    }

    if (clipCopyMode === 'select-target') {
      endClipPress()
      pasteCopiedClipToSlot(clip.trackId, clip.slotIndex)
      return
    }

    if (clipPressOpenedEditor) {
      clipPressOpenedEditor = false
      return
    }

    const track = tracks.find((item) => item.id === clip.trackId)

    if (track) {
      controller.selectTrack(track)
    }

    activeClipId = clip.id
    togglePlaybackActiveClip(clip)
  }

  function togglePlaybackActiveClip(clip: TrackClipView) {
    if (clip.pendingLaunch) {
      playback.cancelClipLaunch(clip.trackId)
      playbackStatus = playback.status
      refreshSelectedTrackClips()
      refreshMatrixTracks()
      return
    }

    if (clip.playbackActive) {
      playback.clearActiveClipForTrack(clip.trackId)
      if (activeClipId === clip.id) {
        activeClipId = undefined
      }
      playbackStatus = playback.status
      refreshSelectedTrackClips()
      refreshMatrixTracks()
      return
    }

    playback.requestClipLaunch(clip.trackId, clip.id)
    playbackStatus = playback.status
    refreshSelectedTrackClips()
    refreshMatrixTracks()
    syncView()
  }

  function launchMatrixScene(slotIndex: number) {
    const clips = matrixTracks.flatMap((track) =>
      track.clips.filter((clip) => clip.slotIndex === slotIndex)
    )

    playback.requestClipLaunches(
      clips.map((clip) => ({
        trackId: clip.trackId,
        clipId: clip.id
      }))
    )

    playbackStatus = playback.status
    refreshSelectedTrackClips()
    refreshMatrixTracks()
    syncView()
  }

  function stopMatrixTrack(trackId: string) {
    const pendingLaunch =
      playbackStatus.liveClips.pendingLaunchByTrackId[trackId]
    const activeLaunch =
      playbackStatus.liveClips.activeClipByTrackId[trackId]

    if (pendingLaunch) {
      playback.cancelClipLaunch(trackId)
    }

    if (activeLaunch) {
      playback.clearActiveClipForTrack(trackId)
    }

    if (
      activeClipId &&
      matrixTrackClips(trackId).some((clip) => clip.id === activeClipId)
    ) {
      activeClipId = undefined
    }
  }

  function stopMatrixScene(slotIndex: number) {
    const clips = matrixTracks.flatMap((track) =>
      track.clips.filter((clip) => clip.slotIndex === slotIndex)
    )

    for (const clip of clips) {
      if (clip.pendingLaunch) {
        playback.cancelClipLaunch(clip.trackId)
      }

      if (clip.playbackActive) {
        playback.clearActiveClipForTrack(clip.trackId)
      }

      if (activeClipId === clip.id) {
        activeClipId = undefined
      }
    }

    playbackStatus = playback.status
    refreshSelectedTrackClips()
    refreshMatrixTracks()
    syncView()
  }

  function stopMatrixAll() {
    for (const track of tracks) {
      stopMatrixTrack(track.id)
    }

    activeClipId = undefined
    playbackStatus = playback.status
    refreshSelectedTrackClips()
    refreshMatrixTracks()
    syncView()
  }

  function stopMatrixTrackAndRefresh(trackId: string) {
    stopMatrixTrack(trackId)
    playbackStatus = playback.status
    refreshSelectedTrackClips()
    refreshMatrixTracks()
    syncView()
  }

  function addClipToSelectedTrack() {
    const clipId = addClipToTrack(selectedTrackId)

    if (clipId) {
      activeClipId = clipId
    }

    syncView()
  }

  function addClipToTrack(
    trackId: string | undefined,
    slotIndex?: number
  ): string | undefined {
    const track = tracks.find((item) => item.id === trackId)

    if (track) {
      controller.selectTrack(track)
    }

    const clipId = controller.createClipForTrack(trackId, slotIndex)

    if (trackId && clipId) {
      ensureClipActiveWhenStopped(trackId, clipId)
    }

    syncView()
    return clipId
  }

  function pasteCopiedClipToSlot(trackId: string, slotIndex: number) {
    if (!clipCopySource) return

    const track = tracks.find((item) => item.id === trackId)
    const existingClip = matrixTrackClips(trackId).find(
      (clip) => clip.slotIndex === slotIndex
    )

    if (track) {
      controller.selectTrack(track)
    }

    if (existingClip) {
      if (playbackStatus.liveClips.pendingLaunchByTrackId[trackId]?.clipId === existingClip.id) {
        playback.cancelClipLaunch(trackId)
      }

      if (playbackStatus.liveClips.activeClipByTrackId[trackId]?.clipId === existingClip.id) {
        playback.clearActiveClipForTrack(trackId)
      }
    }

    const clipId = controller.copyClipToTrackSlot(
      clipCopySource.id,
      trackId,
      slotIndex
    )

    if (clipId) {
      activeClipId = clipId
      ensureClipActiveWhenStopped(trackId, clipId)
    }

    clipCopyMode = 'idle'
    clipCopySource = undefined
    playbackStatus = playback.status
    syncView()
  }

  function removeClip(clip: TrackClipView) {
    if (!controller.deleteClip(clip.id)) return

    if (activeClipId === clip.id) {
      activeClipId = undefined
    }

    if (
      playbackStatus.liveClips.activeClipByTrackId[clip.trackId]?.clipId === clip.id ||
      playbackStatus.liveClips.pendingLaunchByTrackId[clip.trackId]?.clipId === clip.id
    ) {
      playback.clearActiveClipForTrack(clip.trackId)
      playbackStatus = playback.status
    }

    syncView()
  }

  function selectPlacement(placement: TimelinePlacementView) {
    controller.selectPlacement(placement)
    rebuildInspector()
  }

  function addTrack() {
    controller.addTrack()
    syncView()
  }

  function saveProject() {
    try {
      localProjectStore.save(serializeDocument(store.document))
      lastProjectSavedAt = new Date()
      projectPersistenceStatus = `Saved ${lastProjectSavedAt.toLocaleTimeString()}`
    } catch (error) {
      projectPersistenceStatus =
        error instanceof Error ? `Save failed: ${error.message}` : 'Save failed'
    }
  }

  async function loadProject() {
    try {
      const serialized = localProjectStore.load()

      if (!serialized) {
        projectPersistenceStatus = 'No saved project'
        return
      }

      playback.panic()
      store.replaceDocument(deserializeDocument(serialized))
      controller.selectInitialTrack()
      activeClipId = undefined
      activePattern = store.document.patterns.values()[0]
      activeEditor = 'piano-roll'
      viewMode = 'matrix'
      clipCopyMode = 'idle'
      clipCopySource = undefined
      runtimeParameterValues = {}
      automatedRuntimeParameterIds = new Set<string>()
      const restoredAssets = await restoreStoredSampleAssets()
      samplerSampleStatus = sampleRestoreStatus(restoredAssets)
      lastProjectSavedAt = new Date()
      projectPersistenceStatus = `Loaded ${lastProjectSavedAt.toLocaleTimeString()}`
      syncView()
      playbackStatus = playback.status
    } catch (error) {
      projectPersistenceStatus =
        error instanceof Error ? `Load failed: ${error.message}` : 'Load failed'
    }
  }

  async function restoreStoredSampleAssets(): Promise<{
    loaded: number
    missing: number
  }> {
    let loaded = 0
    let missing = 0

    for (const asset of store.document.assets.values()) {
      if (asset.kind !== 'audio-sample') continue
      if (!browserAssetStore.isStoredAsset(asset)) continue

      const runtimeAsset = await browserAssetStore.createRuntimeAsset(asset)

      if (!runtimeAsset) {
        missing += 1
        continue
      }

      try {
        await playback.loadSampleAsset(runtimeAsset.asset)
        loaded += 1
      } finally {
        runtimeAsset.revoke()
      }
    }

    return { loaded, missing }
  }

  function sampleRestoreStatus(result: { loaded: number; missing: number }): string {
    if (result.loaded === 0 && result.missing === 0) {
      return 'Project loaded'
    }

    if (result.missing > 0) {
      return `${result.loaded} samples restored, ${result.missing} missing`
    }

    return `${result.loaded} samples restored`
  }

  function renameSelectedTrack() {
    const nextName = draftName.trim()

    if (!controller.renameSelectedTrack(nextName)) {
      draftName = inspector.type === 'track' ? inspector.title : ''
      return
    }

    syncView()
  }

  function setParameterValue(parameterId: string, value: ParameterValue) {
    runtimeParameterValues = {
      ...runtimeParameterValues,
      [parameterId]: value
    }
    controller.setParameterValue(parameterId, value)
    syncView()
  }

  function movePlacement(placement: TimelinePlacementView, delta: number) {
    if (!controller.movePlacement(placement, delta)) return

    syncView()
  }

  function resizePlacement(placement: TimelinePlacementView, delta: number) {
    if (!controller.resizePlacement(placement, delta)) return

    syncView()
  }

  function setNumberPreview(parameterId: string, value: number) {
    runtimeParameterValues = {
      ...runtimeParameterValues,
      [parameterId]: value
    }
    numberDrafts = {
      ...numberDrafts,
      [parameterId]: value
    }
    inspector = {
      ...inspector,
      properties: inspector.properties.map((property) =>
        property.parameter.id === parameterId
          ? { ...property, value }
          : property
      )
    }
    controller.previewParameterValue(parameterId, value)
  }

  function commitNumberValue(parameterId: string, value: number) {
    numberDrafts = Object.fromEntries(
      Object.entries(numberDrafts).filter(([id]) => id !== parameterId)
    )

    controller.commitNumberValue(parameterId, value)
    runtimeParameterValues = {
      ...runtimeParameterValues,
      [parameterId]: value
    }
    syncView()
  }

  function commitPlacementStart(nextStart: number) {
    if (!controller.setPlacementStart(inspector.placement, nextStart)) return

    syncView()
  }

  function commitPlacementLength(nextLength: number) {
    if (!controller.setPlacementLength(inspector.placement, nextLength)) return

    syncView()
  }

  function commitPlacementLoopCount(nextLoopCount: number) {
    if (!controller.setPlacementLoopCount(inspector.placement, nextLoopCount)) {
      return
    }

    syncView()
  }

  function commitNoteTime(nextTime: number) {
    if (!controller.setNoteTime(inspector.note, nextTime)) return

    syncView()
  }

  function commitNotePitch(nextPitch: number) {
    if (!controller.setNotePitch(inspector.note, nextPitch)) return

    syncView()
  }

  function commitNoteDuration(nextDuration: number) {
    if (!controller.setNoteDuration(inspector.note, nextDuration)) return

    syncView()
  }

  function deleteSelectedNote() {
    if (!controller.deleteNote(inspector.note)) return

    syncView()
  }

  function readNumberValue(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value)
  }

  function formatBeat(beat: number | undefined): string {
    if (beat === undefined) return '--'

    return Number.isInteger(beat) ? String(beat) : beat.toFixed(2)
  }

  function setLaunchQuantize(quantize: ClipLaunchQuantize) {
    playback.setClipLaunchQuantize(quantize)
    playbackStatus = playback.status
    refreshSelectedTrackClips()
    refreshMatrixTracks()
  }

  function launchQuantizeLabel(quantize: ClipLaunchQuantize): string {
    return launchQuantizeOptions.find((option) => option.id === quantize)?.label ?? 'Bar'
  }

  function selectedTrackQueuedLaunch(): string {
    const pendingLaunch =
      playbackStatus.liveClips.pendingLaunchByTrackId[selectedTrackId]

    if (!pendingLaunch) return 'None'

    const clip = selectedTrackClips.find((item) => item.id === pendingLaunch.clipId)

    return `${clip?.name ?? 'Clip'} @ beat ${formatBeat(pendingLaunch.launchAtBeat)}`
  }

  function trackQueuedLaunch(trackId: string): string {
    const pendingLaunch = playbackStatus.liveClips.pendingLaunchByTrackId[trackId]

    if (!pendingLaunch) return 'None'

    const clip = matrixTrackClips(trackId).find(
      (item) => item.id === pendingLaunch.clipId
    )

    return `${clip?.name ?? 'Clip'} @ beat ${formatBeat(pendingLaunch.launchAtBeat)}`
  }

  function matrixTrackClips(trackId: string): MatrixClipView[] {
    return controller.trackClips(
      trackId,
      activeClipId,
      playbackStatus.liveClips.activeClipByTrackId[trackId]?.clipId,
      playbackStatus.liveClips.pendingLaunchByTrackId[trackId]
    ).map((clip) => ({
      ...clip,
      playbackProgress: clip.playbackActive
        ? clipPlaybackProgress(trackId, clip.id)
        : undefined,
      queuedProgress: clip.pendingLaunch
        ? clipQueuedProgress(trackId)
        : undefined
    }))
  }

  function clipPlaybackProgress(trackId: string, clipId: string): number | undefined {
    const activeLaunch = playbackStatus.liveClips.activeClipByTrackId[trackId]
    const clip = store.document.midiClips.find(clipId)

	    if (!effectiveTransportPlaying || !activeLaunch || !clip) return undefined

	    const clipLength = Math.max(0.25, clip.length)
	    const localBeat = effectiveTransportBeat - activeLaunch.launchedAtBeat

    if (localBeat < 0) return 0

    if (!clip.loopEnabled || clip.loopLength <= 0 || localBeat < clip.loopStart) {
      return clampUnit(localBeat / clipLength)
    }

    const loopStart = Math.min(Math.max(0, clip.loopStart), clipLength)
    const loopLength = Math.min(
      Math.max(0.25, clip.loopLength),
      Math.max(0.25, clipLength - loopStart)
    )
    const loopBeat = loopStart + ((localBeat - loopStart) % loopLength)

    return clampUnit(loopBeat / clipLength)
  }

  function clipQueuedProgress(trackId: string): number | undefined {
    const pendingLaunch = playbackStatus.liveClips.pendingLaunchByTrackId[trackId]

    if (!pendingLaunch) return undefined

    const duration = pendingLaunch.launchAtBeat - pendingLaunch.requestedAtBeat

    if (duration <= 0) return 1

	    return clampUnit((effectiveTransportBeat - pendingLaunch.requestedAtBeat) / duration)
  }

  function displayedTrackParameterValue(
    property: InspectorPropertyView
  ): ParameterValue {
    return runtimeParameterValues[property.parameter.id] ?? property.value
  }

  function toggleBooleanParameter(property: InspectorPropertyView) {
    setParameterValue(
      property.parameter.id,
      !Boolean(displayedTrackParameterValue(property))
    )
  }

  function undo() {
    controller.undo()
    syncView()
  }

  function redo() {
    controller.redo()
    syncView()
  }

	  function clampUnit(value: number): number {
	    if (!Number.isFinite(value)) return 0

	    return Math.min(1, Math.max(0, value))
	  }

	  function nowMs(): number {
	    return globalThis.performance?.now() ?? Date.now()
	  }
</script>

<Workbench workspaceMode={viewMode === 'matrix' ? 'full' : 'split'}>
  <svelte:fragment slot="top">
    <div class="document-heading">
      <h1>{store.document.name}</h1>
    </div>

    <TransportPanel
	      playing={effectiveTransportPlaying}
	      bpm={transportBpm}
	      beat={effectiveTransportBeat}
      swingAmount={groove.amount}
      onPlay={playTransport}
      onStop={stopTransport}
      onBpmChange={setRuntimeBpm}
      onSwingChange={setSwingAmount}
      {playbackBackendKind}
      {nativeBackendAvailable}
      onBackendChange={setPlaybackBackendKind}
      {diagnosticsOpen}
      onToggleDiagnostics={toggleDiagnosticsOverlay}
    />

    <div class="toolbar" aria-label="Document operations">
      {#if viewMode === 'editor'}
        <button
          type="button"
          class="toolbar-icon-button primary"
          aria-label="Show matrix"
          title="Show matrix"
          on:click={showMatrixView}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 4h6v6H4z" />
            <path d="M14 4h6v6h-6z" />
            <path d="M4 14h6v6H4z" />
            <path d="M14 14h6v6h-6z" />
          </svg>
        </button>
      {/if}
      <button
        type="button"
        class="toolbar-icon-button"
        aria-label="Add track"
        title="Add track"
        on:click={addTrack}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </button>
      <button
        type="button"
        class="toolbar-icon-button"
        aria-label="Save project"
        title="Save project"
        on:click={saveProject}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 4h12l2 2v14H5z" />
          <path d="M8 4v6h8V4" />
          <path d="M8 17h8" />
        </svg>
      </button>
      <button
        type="button"
        class="toolbar-icon-button"
        aria-label="Load project"
        title="Load project"
        on:click={loadProject}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19h16" />
          <path d="M12 5v10" />
          <path d="m8 11 4 4 4-4" />
        </svg>
      </button>
      <button
        type="button"
        class="toolbar-icon-button"
        aria-label="Undo"
        title="Undo"
        on:click={undo}
        disabled={!canUndo}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 7 5 11l4 4" />
          <path d="M5 11h9a5 5 0 0 1 0 10h-2" />
        </svg>
      </button>
      <button
        type="button"
        class="toolbar-icon-button"
        aria-label="Redo"
        title="Redo"
        on:click={redo}
        disabled={!canRedo}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 7 4 4-4 4" />
          <path d="M19 11h-9a5 5 0 0 0 0 10h2" />
        </svg>
      </button>
      <span class="project-save-status">{projectPersistenceStatus}</span>
    </div>
  </svelte:fragment>

  <svelte:fragment slot="left">
    {#if viewMode === 'editor'}
      <InspectorPanel
        inspector={displayedInspector}
        selectedType={selected?.type ?? 'track'}
        bind:draftName
        onRenameTrack={renameSelectedTrack}
        onSetNumberPreview={setNumberPreview}
        onCommitNumberValue={commitNumberValue}
        onSetParameterValue={setParameterValue}
        onCommitPlacementStart={commitPlacementStart}
        onCommitPlacementLength={commitPlacementLength}
        onCommitPlacementLoopCount={commitPlacementLoopCount}
        onCommitNotePitch={commitNotePitch}
        onCommitNoteTime={commitNoteTime}
        onCommitNoteDuration={commitNoteDuration}
        onDeleteSelectedNote={deleteSelectedNote}
        onSetTrackMute={(trackId, value) =>
          setTrackMixerValue(trackId, 'mute', value)}
        onSetTrackSolo={(trackId, value) =>
          setTrackMixerValue(trackId, 'solo', value)}
        onSetTrackVolume={(trackId, value) =>
          setTrackMixerValue(trackId, 'volume', value)}
        onSetTrackPan={(trackId, value) =>
          setTrackMixerValue(trackId, 'pan', value)}
        onStopTrack={stopMatrixTrackAndRefresh}
        onArmClip={armEditedClip}
        onSetClipLoop={toggleActivePatternClipLoop}
        onSetClipEnd={setActivePatternClipEnd}
        onSetClipLoopStart={setActivePatternClipLoopStart}
        onSetClipLoopEnd={setActivePatternClipLoopEnd}
        onSetBeatDivisions={setEditorBeatDivisions}
        onQuantizeClipSelection={quantizeEditorSelection}
        onHumanizeClipSelection={humanizeEditorSelection}
        onToggleVelocityLane={() => {
          showVelocityLane = !showVelocityLane
        }}
        onToggleProbabilityLane={() => {
          showProbabilityLane = !showProbabilityLane
        }}
        onToggleAutomationLane={() => {
          showAutomationLane = !showAutomationLane
        }}
        onScaleRootChange={setEditorScaleRoot}
        onScaleIdChange={setEditorScaleId}
        onScaleModeChange={setEditorScaleMode}
      />
    {/if}
  </svelte:fragment>
  
  <svelte:fragment slot="center">
    {#if viewMode === 'matrix'}
      <MatrixView
        {matrixTracks}
        sceneRows={matrixSceneRows}
        {selectedTrackId}
        launchQuantize={playbackStatus.liveClips.launchQuantize}
        {launchQuantizeOptions}
        {launchQuantizeLabel}
        {formatBeat}
        onSetLaunchQuantize={setLaunchQuantize}
        onSelectTrack={selectTrack}
        onClipPointerDown={startClipPress}
        onClipPointerEnd={endClipPress}
        onClipClick={launchMatrixClip}
        onSceneLaunch={launchMatrixScene}
        onSceneStop={stopMatrixScene}
        onTrackStop={stopMatrixTrackAndRefresh}
        onStopAll={stopMatrixAll}
        onAddClipToTrack={addClipToTrack}
        onSetTrackMixerValue={setTrackMixerValue}
        {clipCopyMode}
        clipCopySourceId={clipCopySource?.id}
        onToggleClipCopyMode={toggleClipCopyMode}
        onPasteClipToSlot={pasteCopiedClipToSlot}
      />
    {:else}
      <div class="editor-stack">
        <PatternEditor
          bars={1}
          beatsPerBar={4}
          height={420}
          width="100%"
          {controller}
          {pianoRoll}
          {activeEditor}
          {activeClipId}
          beatDivisions={editorBeatDivisions}
          scale={editorScale}
          playheadBeat={activePatternPlayheadBeat}
          {groove}
          clipLength={activePatternClipLoopRegion.clipLength}
          onRenderModelRebuild={setRenderModelRebuildTime}
          {automationTargets}
          bind:showVelocityLane
          bind:showProbabilityLane
          bind:showAutomationLane
          sampleGridLanes={selectedSamplerGridLanes(selectedTrack)}
          onEditorChange={(editor) => {
            activeEditor = editor;
            syncView();
          }}
          {syncView}
        />
      </div>
    {/if}
  </svelte:fragment>

  

  <svelte:fragment slot="bottom">
    <TrackModules
      {selectedTrack}
      {selectedTrackId}
      {selectedTrackDeviceName}
      selectedTrackDeviceKind={selectedTrackDeviceKind(selectedTrack)}
      {selectedTrackDeviceParameterViews}
      selectedTrackMidiDeviceKind={selectedTrackMidiDeviceKind(selectedTrack)}
      {selectedTrackMidiDeviceParameterViews}
      selectedTrackHasLfo={selectedTrackHasLfo(selectedTrack)}
      selectedTrackLfoDevice={findTrackLfoDevice(selectedTrack)}
      {selectedTrackLfoParameterViews}
      {lfoModulationTargetOptions}
      selectedTrackAudioEffectKind={selectedTrackAudioEffectKind(selectedTrack)}
      {selectedTrackAudioEffectParameterViews}
      samplerSampleName={buildSelectedSamplerSampleName(selectedTrack)}
      samplerSlot={selectedSamplerSlot(selectedTrack)}
      samplerSlots={selectedSamplerSlots(selectedTrack)}
      {selectedSamplerSlotId}
      {samplerSampleStatus}
      onLoadSamplerSampleFile={loadSamplerSampleFile}
      onSetSamplerSampleSlot={setSamplerSampleSlot}
      onSelectSamplerSlot={selectSamplerSlot}
      onSetDeviceParameterValue={setDeviceParameterValue}
      onAttachDevice={attachTrackDevice}
      onAttachMidiDevice={attachTrackMidiDevice}
      onRemoveMidiDevice={removeTrackMidiDevice}
      onAttachAudioEffect={attachTrackAudioEffect}
      onRemoveAudioEffect={removeTrackAudioEffect}
      onRemoveDevice={removeSelectedTrackDevice}
    />

    <footer class="statusbar">
      <span>{store.document.patterns.values().length} patterns</span>
      <span>{store.document.parameterDefinitions.values().length} property types</span>
      <span>{store.document.parameters.values().length} properties</span>
      <span class:ok={issues.length === 0}>{issues.length} issues</span>
    </footer>
  </svelte:fragment>
</Workbench>

{#if diagnosticsOpen}
  <RuntimePanel
	    transportPlaying={effectiveTransportPlaying}
	    {transportBpm}
	    transportBeat={effectiveTransportBeat}
      {playbackBackendKind}
	    runtimeTransportState={runtimeTransportStatus.state}
	    runtimeTransportFailure={runtimeTransportStatus.state === 'failed'
	      ? runtimeTransportStatus.message
	      : undefined}
	    runtimeCommandPending={playbackStatus.runtime?.commandPending ?? false}
	    runtimeSamplePosition={playbackStatus.runtime?.snapshot?.transport.samplePosition}
	    runtimeSampleRate={playbackStatus.runtime?.snapshot?.stream.sampleRate}
	    runtimeCallbackCount={playbackStatus.runtime?.snapshot?.stream.callbackCount}
	    runtimeActivePlanId={playbackStatus.runtime?.snapshot?.plan.activePlanId}
	    runtimeActiveRevision={playbackStatus.runtime?.snapshot?.plan.activeRevision}
	    runtimePendingTransfers={playbackStatus.runtime?.snapshot?.plan.pendingTransfers}
	    runtimeXruns={playbackStatus.runtime?.snapshot?.diagnostics.xruns}
	    runtimeQueueOverflows={playbackStatus.runtime?.snapshot?.diagnostics.queueOverflows}
	    nativeRuntimeAction={playbackStatus.nativeRuntime.lastAction}
	    nativeRuntimeCommands={playbackStatus.nativeRuntime.lastCommandTypes.join(', ')}
	    nativeRuntimeError={playbackStatus.nativeRuntime.lastError}
    {audioEngineStatus}
    {midiStatus}
    {preferencesStatus}
    clockSource={clockStatus.activeSourceName}
    clockRunning={clockStatus.state.running}
    clockBeat={clockStatus.state.beat}
    clockBpm={clockStatus.state.bpm}
    clockDrift={clockStatus.state.driftMs}
    playbackRunning={playbackStatus.running}
    playbackQueuedEvents={playbackStatus.queuedEventCount}
    playbackBeat={playbackStatus.currentBeat}
    playbackLastEvent={formatPlaybackEvent(playbackStatus.lastEmittedEvent)}
    playbackEventCount={playbackStatus.statistics.eventCount}
    playbackEventsPerSecond={playbackStatus.statistics.eventsPerSecond}
    playbackLastBatchSize={playbackStatus.outputManager.lastEventCount}
    voiceActive={playbackStatus.voice?.active ?? 0}
    voiceReleased={playbackStatus.voice?.released ?? 0}
    voiceStolen={playbackStatus.voice?.stolen ?? 0}
    voiceTotalStarted={playbackStatus.voice?.totalStarted ?? 0}
    voiceTotalReleased={playbackStatus.voice?.totalReleased ?? 0}
    voiceTotalStolen={playbackStatus.voice?.totalStolen ?? 0}
    schedulerJitterMs={playbackStatus.statistics.schedulerJitterMs}
    schedulerLatencyMs={playbackStatus.statistics.schedulerLatencyMs}
    maxLookaheadDepthMs={playbackStatus.statistics.maxLookaheadDepthMs}
    largestEventBatch={playbackStatus.statistics.largestEventBatch}
    lateEventCount={playbackStatus.statistics.lateEventCount}
    missedEventCount={playbackStatus.statistics.missedEventCount}
    playbackModelRebuildMs={playbackStatus.statistics.playbackModelRebuildMs}
    {renderModelRebuildMs}
  />
{/if}

<style>
  .editor-stack {
    display: grid;
    gap: var(--spacing-xl);
    min-width: 0;
  }
</style>
