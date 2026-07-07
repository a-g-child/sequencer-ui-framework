<script lang="ts">
  import { onMount } from 'svelte'
  import {
    SequencerApplication,
    validateDocument,
    type SelectionItem,
    type ServiceEvent,
    type ParameterValue,
    type Pattern,
    type Track
  } from '@sequencer/core'
  import {
    ClockService,
    PlaybackService,
    type ClockServiceStatus,
    type ClipLaunchQuantize,
    type PlaybackEvent,
    type PlaybackRuntimeParameterValue,
    type PlaybackServiceStatus
  } from '@sequencer/playback'
  import {
    BASIC_SYNTH_DESCRIPTOR,
    EXTERNAL_MIDI_DESCRIPTOR,
    type DeviceDescriptor,
    type DeviceInstance,
    type DeviceParameterDescriptor,
    type DeviceParameterValue
  } from '@sequencer/device'
  import { AppController, type TrackClipView } from './lib/app-controller'
  import {
    buildInspectorView,
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
  import {
    buildPatternAutomationTargets,
    deviceAutomationTargetId
  } from './lib/music/pattern/pattern-automation';
  import Workbench from './lib/framework/application/Workbench.svelte';
  import InspectorPanel from './lib/panels/InspectorPanel.svelte';
  import RuntimePanel from './lib/panels/RuntimePanel.svelte';
  import TransportPanel from './lib/panels/TransportPanel.svelte';
  import MatrixView from './lib/matrix/MatrixView.svelte';
  import type { MatrixClipView, MatrixTrackView } from './lib/matrix/matrix-view-model';
  import TrackModules from './lib/modules/TrackModules.svelte';

  type MainViewMode = 'matrix' | 'editor'

  type DeviceParameterView = {
    device: DeviceInstance
    descriptor: DeviceParameterDescriptor
    value: DeviceParameterValue
    runtimeValue?: DeviceParameterValue
    automated?: boolean
  }

  const DEVICE_DESCRIPTORS: DeviceDescriptor[] = [
    BASIC_SYNTH_DESCRIPTOR,
    EXTERNAL_MIDI_DESCRIPTOR
  ]
  const DEVICE_DESCRIPTORS_BY_KEY = new Map(
    DEVICE_DESCRIPTORS.map((descriptor) => [descriptor.key, descriptor])
  )

  const app = new SequencerApplication()
  const clock = app.services.add(new ClockService())
  const playback = app.services.add(new PlaybackService())
  const controller = new AppController(app)
  const store = app.documentStore
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
    const unsubscribe = app.serviceEvents.subscribe(handleServiceEvent)
    void app.initialise()

    return () => {
      unsubscribe()
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
    buildSelectedTrackDeviceParameterViews(
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
  let audioEngineStatus = 'idle'
  let midiStatus = 'idle'
  let preferencesStatus = 'not loaded'
  let clockStatus: ClockServiceStatus = clock.status
  let playbackStatus: PlaybackServiceStatus = playback.status
  let selectedTrackWebAudioSettings =
    playback.webAudioTrackSettings(selectedTrackId)
  let webAudioEnabled = selectedTrackWebAudioSettings.enabled
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
  let activeEditor: EditorKind = 'piano-roll';
  let viewMode: MainViewMode = 'matrix'
  let clipPressTimer: ReturnType<typeof setTimeout> | undefined
  let clipPressOpenedEditor = false
  $: activePatternPlayheadBeat = localPlayheadBeat(
    transportPlaying,
    transportBeat,
    activePatternClipLoop,
    activePatternClipLoopRegion
  )
  $: displayedInspector = applyRuntimeParameterValues(
    inspector,
    runtimeParameterValues
  )
  $: selectedTrack = tracks.find((track) => track.id === selectedTrackId)
  $: selectedTrackParameterViews = buildTrackParameterViews(selectedTrack)
  $: selectedTrackDeviceName = buildSelectedTrackDeviceName(selectedTrack)
  $: selectedTrackDeviceParameterViews =
    buildSelectedTrackDeviceParameterViews(
      selectedTrack,
      runtimeParameterValues,
      automatedRuntimeParameterIds,
      activePattern?.id
    )
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
      buildSelectedTrackDeviceParameterViews(
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
    selectedTrackClips = controller.trackClips(
      selectedTrackId,
      activeClipId,
      playbackStatus.liveClips.activeClipByTrackId[selectedTrackId]?.clipId,
      playbackStatus.liveClips.pendingLaunchByTrackId[selectedTrackId]
    )
    refreshMatrixTracks()
    refreshSelectedTrackWebAudioSettings()
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
      refreshSelectedTrackClips()
      refreshMatrixTracks()
      refreshSelectedTrackWebAudioSettings()
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
    const nextAutomationIds = new Set(values.map((value) => value.parameterId))

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

  function refreshSelectedTrackClips() {
    selectedTrackClips = controller.trackClips(
      selectedTrackId,
      activeClipId,
      playbackStatus.liveClips.activeClipByTrackId[selectedTrackId]?.clipId,
      playbackStatus.liveClips.pendingLaunchByTrackId[selectedTrackId]
    )
  }

  function refreshMatrixTracks() {
    matrixTracks = buildMatrixTracks()
  }

  function buildMatrixTracks(): MatrixTrackView[] {
    return tracks.map((track) => ({
      track,
      clips: matrixTrackClips(track.id),
      queuedLaunch: trackQueuedLaunch(track.id)
    }))
  }

  function refreshSelectedTrackWebAudioSettings() {
    selectedTrackWebAudioSettings = playback.webAudioTrackSettings(selectedTrackId)
    webAudioEnabled =
      selectedTrackWebAudioSettings.enabled &&
      playbackStatus.outputManager.activeOutputIds.includes('web-audio')
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

  function buildSelectedTrackDeviceParameterViews(
    track: Track | undefined,
    values: Record<string, ParameterValue>,
    automatedIds: Set<string>,
    patternId: string | undefined
  ): DeviceParameterView[] {
    const device = findTrackDeviceInstance(track)

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

  function findTrackDeviceInstance(
    track: Track | undefined
  ): DeviceInstance | undefined {
    if (!track?.deviceId) return undefined

    return store.document.deviceInstances.find(track.deviceId)
  }

  function playTransport() {
    ensureSelectedClipActiveWhenStopped()
    controller.playTransport()
  }

  function stopTransport() {
    controller.stopTransport()
  }

  function setRuntimeBpm(event: Event) {
    const bpm = readNumberValue(event)

    controller.setRuntimeBpm(bpm)
  }

  async function setSelectedTrackWebAudioEnabled(enabled: boolean) {
    webAudioEnabled = enabled

    if (selectedTrackId) {
      playback.setWebAudioTrackSettings(selectedTrackId, { enabled })

      if (enabled) {
        await playback.setWebAudioEnabled(true)
      }
    } else {
      await playback.setWebAudioEnabled(enabled)
    }

    playbackStatus = playback.status
    refreshSelectedTrackWebAudioSettings()
  }

  async function toggleWebAudioOutput() {
    await setSelectedTrackWebAudioEnabled(!webAudioEnabled)
  }

  function setDeviceParameterValue(
    deviceInstanceId: string,
    parameterKey: string,
    value: DeviceParameterValue
  ) {
    controller.setDeviceParameterValue(deviceInstanceId, parameterKey, value)
    syncView()
  }

  function toggleDiagnosticsOverlay() {
    diagnosticsOpen = !diagnosticsOpen
  }

  function showMatrixView() {
    viewMode = 'matrix'
    endClipPress()
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

  function addClipToSelectedTrack() {
    const clipId = addClipToTrack(selectedTrackId)

    if (clipId) {
      activeClipId = clipId
    }

    syncView()
  }

  function addClipToTrack(trackId: string | undefined): string | undefined {
    const track = tracks.find((item) => item.id === trackId)

    if (track) {
      controller.selectTrack(track)
    }

    const clipId = controller.createClipForTrack(trackId)

    if (trackId && clipId) {
      ensureClipActiveWhenStopped(trackId, clipId)
    }

    syncView()
    return clipId
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

    if (!transportPlaying || !activeLaunch || !clip) return undefined

    const clipLength = Math.max(0.25, clip.length)
    const localBeat = transportBeat - activeLaunch.launchedAtBeat

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

    return clampUnit((transportBeat - pendingLaunch.requestedAtBeat) / duration)
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
</script>

<Workbench workspaceMode={viewMode === 'matrix' ? 'full' : 'split'}>
  <svelte:fragment slot="top">
    <div>
      <p class="eyebrow">Sequencer</p>
      <h1>{store.document.name}</h1>
    </div>

    <TransportPanel
      playing={transportPlaying}
      bpm={transportBpm}
      beat={transportBeat}
      onPlay={playTransport}
      onStop={stopTransport}
      onBpmChange={setRuntimeBpm}
      {diagnosticsOpen}
      onToggleDiagnostics={toggleDiagnosticsOverlay}
    />

    <div class="toolbar" aria-label="Document operations">
      {#if viewMode === 'editor'}
        <button type="button" on:click={showMatrixView}>Matrix</button>
      {/if}
      <button type="button" on:click={addTrack}>Add Track</button>
      <button type="button" on:click={undo} disabled={!canUndo}>Undo</button>
      <button type="button" on:click={redo} disabled={!canRedo}>Redo</button>
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
      />
    {/if}
  </svelte:fragment>
  
  <svelte:fragment slot="center">
    {#if viewMode === 'matrix'}
      <MatrixView
        {matrixTracks}
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
        onAddClipToTrack={addClipToTrack}
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
          playheadBeat={activePatternPlayheadBeat}
          loopClip={activePatternClipLoop}
          loopRegion={activePatternClipLoopRegion}
          clipLength={activePatternClipLoopRegion.clipLength}
          onLoopClipChange={toggleActivePatternClipLoop}
          onLoopRegionChange={setActivePatternClipLoopRegion}
          onClipBoundsChange={setActivePatternClipBounds}
          onRenderModelRebuild={setRenderModelRebuildTime}
          {automationTargets}
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
      {selectedTrackParameterViews}
      {selectedTrackDeviceName}
      {selectedTrackDeviceParameterViews}
      {webAudioEnabled}
      {displayedTrackParameterValue}
      onSetNumberPreview={setNumberPreview}
      onCommitNumberValue={commitNumberValue}
      onSetParameterValue={setParameterValue}
      onToggleBooleanParameter={toggleBooleanParameter}
      onToggleWebAudioOutput={toggleWebAudioOutput}
      onSetDeviceParameterValue={setDeviceParameterValue}
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
    {transportPlaying}
    {transportBpm}
    {transportBeat}
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
