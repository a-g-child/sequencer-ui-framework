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
    type PlaybackServiceStatus,
    type WebAudioOscillatorSettings,
    type WebAudioWaveform
  } from '@sequencer/playback'
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
  import { buildPatternAutomationTargets } from './lib/music/pattern/pattern-automation';
  import Workbench from './lib/framework/application/Workbench.svelte';
  import InspectorPanel from './lib/panels/InspectorPanel.svelte';
  import RuntimePanel from './lib/panels/RuntimePanel.svelte';
  import TransportPanel from './lib/panels/TransportPanel.svelte';

  type MainViewMode = 'matrix' | 'editor'

  

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
    buildTrackParameterViews(activePatternTrack)
  )
  let activePatternClipLoop = controller.isPatternClipLooping(activePattern?.id)
  let activePatternClipLoopRegion = controller.patternClipLoopRegion(
    activePattern?.id
  )
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
  let selectedTrackWebAudioSettings: WebAudioOscillatorSettings =
    playback.webAudioTrackSettings(selectedTrackId)
  let webAudioEnabled = selectedTrackWebAudioSettings.enabled
  let webAudioWaveform: WebAudioWaveform = selectedTrackWebAudioSettings.waveform
  let webAudioVolume = selectedTrackWebAudioSettings.volume
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
      buildTrackParameterViews(activePatternTrack)
    )
    activePatternClipLoop = controller.isPatternClipLooping(activePattern?.id)
    activePatternClipLoopRegion = controller.patternClipLoopRegion(activePattern?.id)
    selectedTrackClips = controller.trackClips(
      selectedTrackId,
      activeClipId,
      playbackStatus.liveClips.activeClipByTrackId[selectedTrackId]?.clipId,
      playbackStatus.liveClips.pendingLaunchByTrackId[selectedTrackId]
    )
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
    }

    if (event.type === 'clock:tempo-changed') {
      const payload = event.payload as { bpm?: number } | undefined
      transportBpm = payload?.bpm ?? transportBpm
    }

    if (event.type === 'clock:stopped') {
      runtimeParameterValues = {}
      automatedRuntimeParameterIds = new Set()
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

  function refreshSelectedTrackWebAudioSettings() {
    selectedTrackWebAudioSettings = playback.webAudioTrackSettings(selectedTrackId)
    webAudioEnabled = selectedTrackWebAudioSettings.enabled
    webAudioWaveform = selectedTrackWebAudioSettings.waveform
    webAudioVolume = selectedTrackWebAudioSettings.volume
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

  function playTransport() {
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

  function setWebAudioWaveform(event: Event) {
    const waveform = (event.currentTarget as HTMLSelectElement).value as WebAudioWaveform

    webAudioWaveform = waveform

    if (selectedTrackId) {
      playback.setWebAudioTrackSettings(selectedTrackId, { waveform })
    } else {
      playback.setWebAudioWaveform(waveform)
    }

    refreshSelectedTrackWebAudioSettings()
  }

  function setWebAudioVolume(event: Event) {
    const volume = readNumberValue(event)

    webAudioVolume = volume

    if (selectedTrackId) {
      playback.setWebAudioTrackSettings(selectedTrackId, { volume })
    } else {
      playback.setWebAudioVolume(volume)
    }

    refreshSelectedTrackWebAudioSettings()
  }

  function setWebAudioAttack(event: Event) {
    setWebAudioAdsrValue('attackMs', readNumberValue(event))
  }

  function setWebAudioDecay(event: Event) {
    setWebAudioAdsrValue('decayMs', readNumberValue(event))
  }

  function setWebAudioSustain(event: Event) {
    setWebAudioAdsrValue('sustain', readNumberValue(event))
  }

  function setWebAudioRelease(event: Event) {
    setWebAudioAdsrValue('releaseMs', readNumberValue(event))
  }

  function setWebAudioAdsrValue(
    key: keyof WebAudioOscillatorSettings['adsr'],
    value: number
  ) {
    if (!selectedTrackId) return

    playback.setWebAudioTrackSettings(selectedTrackId, {
      adsr: {
        [key]: value
      }
    })
    refreshSelectedTrackWebAudioSettings()
  }

  function toggleDiagnosticsOverlay() {
    diagnosticsOpen = !diagnosticsOpen
  }

  function showMatrixView() {
    viewMode = 'matrix'
    endClipPress()
  }

  function toggleActivePatternClipLoop(loop: boolean) {
    if (!controller.setPatternClipLoop(activePattern?.id, loop)) return

    syncView()
  }

  function setActivePatternClipLoopRegion(loopStart: number, loopLength: number) {
    if (
      !controller.setPatternClipLoopRegion(
        activePattern?.id,
        loopStart,
        loopLength
      )
    ) {
      return
    }

    syncView()
  }

  function setActivePatternClipBounds(clipStart: number, clipLength: number) {
    if (
      !controller.setPatternClipBounds(activePattern?.id, clipStart, clipLength)
    ) {
      return
    }

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
    syncView()
  }

  function openClipEditor(clip: TrackClipView) {
    const track = tracks.find((item) => item.id === clip.trackId)

    if (track) {
      controller.selectTrack(track)
    }

    activeClipId = clip.id
    viewMode = 'editor'
    syncView()
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

    togglePlaybackActiveClip(clip)
  }

  function togglePlaybackActiveClip(clip: TrackClipView) {
    if (clip.pendingLaunch) {
      playback.cancelClipLaunch(clip.trackId)
      refreshSelectedTrackClips()
      return
    }

    if (clip.playbackActive) {
      playback.clearActiveClipForTrack(clip.trackId)
      refreshSelectedTrackClips()
      return
    }

    playback.requestClipLaunch(clip.trackId, clip.id)
    playbackStatus = playback.status
    refreshSelectedTrackClips()
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

  function matrixTrackClips(trackId: string): TrackClipView[] {
    return controller.trackClips(
      trackId,
      activeClipId,
      playbackStatus.liveClips.activeClipByTrackId[trackId]?.clipId,
      playbackStatus.liveClips.pendingLaunchByTrackId[trackId]
    )
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
      <section class="matrix-view" aria-label="Clip matrix">
        <div class="matrix-toolbar">
          <div>
            <h2>Matrix</h2>
            <span>
              Launch quantize: {launchQuantizeLabel(playbackStatus.liveClips.launchQuantize)}
            </span>
          </div>

          <div class="clip-launch-controls" aria-label="Clip launch quantize">
            {#each launchQuantizeOptions as option (option.id)}
              <button
                type="button"
                class:active={playbackStatus.liveClips.launchQuantize === option.id}
                on:click={() => setLaunchQuantize(option.id)}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="matrix-grid">
          {#each tracks as track (track.id)}
            <section
              class="matrix-track"
              class:selected={track.id === selectedTrackId}
              aria-label={`${track.name} clips`}
            >
              <button
                type="button"
                class="matrix-track-header"
                class:selected={track.id === selectedTrackId}
                on:click={() => selectTrack(track)}
              >
                <span>{track.name}</span>
                <small>{trackQueuedLaunch(track.id)}</small>
              </button>

              <div class="matrix-clip-stack">
                {#each matrixTrackClips(track.id) as clip (clip.id)}
                  <button
                    type="button"
                    class="matrix-clip"
                    class:active={clip.active}
                    class:playing={clip.playbackActive}
                    class:queued={clip.pendingLaunch}
                    aria-pressed={clip.playbackActive || clip.pendingLaunch}
                    title="Click to launch, long press to edit"
                    on:pointerdown={() => startClipPress(clip)}
                    on:pointerup={endClipPress}
                    on:pointerleave={endClipPress}
                    on:pointercancel={endClipPress}
                    on:click={() => launchMatrixClip(clip)}
                  >
                    <span>{clip.name}</span>
                    <small>
                      {#if clip.pendingLaunch}
                        queued {formatBeat(clip.launchAtBeat)}
                      {:else if clip.playbackActive}
                        playing
                      {:else}
                        slot {clip.slotIndex + 1}
                      {/if}
                    </small>
                  </button>
                {/each}

                <button
                  type="button"
                  class="matrix-add-clip"
                  aria-label={`Add clip to ${track.name}`}
                  on:click={() => addClipToTrack(track.id)}
                >
                  +
                </button>
              </div>
            </section>
          {/each}
        </div>
      </section>
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
    <section class="track-modules" aria-label="Selected track options">
      <div class="track-module track-module-summary">
        <span>Selected Track</span>
        <strong>{selectedTrack?.name ?? 'None'}</strong>
      </div>

      <section class="track-module" aria-label="Track parameters">
        <div class="module-heading">
          <h2>Track</h2>
          <span>Volume / Pan / Mute</span>
        </div>

        <div class="parameter-module-grid">
          {#each selectedTrackParameterViews as property (property.parameter.id)}
            <label class="module-control">
              <span>{property.definition.name}</span>
              {#if property.definition.kind === 'number'}
                <input
                  type="range"
                  min={property.definition.min ?? 0}
                  max={property.definition.max ?? 1}
                  step={property.definition.step ?? 0.01}
                  value={Number(displayedTrackParameterValue(property))}
                  on:input={(event) =>
                    setNumberPreview(property.parameter.id, readNumberValue(event))}
                  on:change={(event) =>
                    commitNumberValue(property.parameter.id, readNumberValue(event))}
                  disabled={!selectedTrackId}
                />
                <strong>{Number(displayedTrackParameterValue(property)).toFixed(2)}</strong>
              {:else if property.definition.kind === 'boolean'}
                <button
                  type="button"
                  class="module-toggle"
                  class:active={Boolean(displayedTrackParameterValue(property))}
                  aria-pressed={Boolean(displayedTrackParameterValue(property))}
                  on:click={() => toggleBooleanParameter(property)}
                  disabled={!selectedTrackId}
                >
                  {Boolean(displayedTrackParameterValue(property)) ? 'On' : 'Off'}
                </button>
              {:else}
                <input
                  value={String(displayedTrackParameterValue(property))}
                  on:change={(event) =>
                    setParameterValue(
                      property.parameter.id,
                      (event.currentTarget as HTMLInputElement).value
                    )}
                  disabled={!selectedTrackId}
                />
              {/if}
            </label>
          {/each}
        </div>
      </section>

      <section class="track-module" aria-label="Sound oscillator">
        <div class="module-heading">
          <h2>Sound</h2>
          <span>Web Audio oscillator</span>
        </div>

        <div class="audio-output-panel" aria-label="Audio output">
          <div class="audio-toggle">
            <span>Audio</span>
            <button
              type="button"
              class="audio-enable-button"
              class:active={webAudioEnabled}
              aria-pressed={webAudioEnabled}
              on:click={toggleWebAudioOutput}
              disabled={!selectedTrackId}
            >
              {webAudioEnabled ? 'On' : 'Off'}
            </button>
          </div>

          <label>
            <span>Wave</span>
            <select
              value={webAudioWaveform}
              on:change={setWebAudioWaveform}
              disabled={!selectedTrackId}
            >
              <option value="sine">Sine</option>
              <option value="square">Square</option>
              <option value="sawtooth">Saw</option>
              <option value="triangle">Triangle</option>
            </select>
          </label>

          <label>
            <span>Gain</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={webAudioVolume}
              on:input={setWebAudioVolume}
              disabled={!selectedTrackId}
            />
          </label>

          <label>
            <span>A</span>
            <input
              type="range"
              min="0"
              max="2000"
              step="5"
              value={selectedTrackWebAudioSettings.adsr.attackMs}
              on:input={setWebAudioAttack}
              disabled={!selectedTrackId}
            />
          </label>

          <label>
            <span>D</span>
            <input
              type="range"
              min="0"
              max="2000"
              step="5"
              value={selectedTrackWebAudioSettings.adsr.decayMs}
              on:input={setWebAudioDecay}
              disabled={!selectedTrackId}
            />
          </label>

          <label>
            <span>S</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={selectedTrackWebAudioSettings.adsr.sustain}
              on:input={setWebAudioSustain}
              disabled={!selectedTrackId}
            />
          </label>

          <label>
            <span>R</span>
            <input
              type="range"
              min="0"
              max="3000"
              step="5"
              value={selectedTrackWebAudioSettings.adsr.releaseMs}
              on:input={setWebAudioRelease}
              disabled={!selectedTrackId}
            />
          </label>
        </div>
      </section>
    </section>

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

  .matrix-view {
    min-width: 0;
    display: grid;
    gap: var(--spacing-lg);
  }

  .matrix-toolbar {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--spacing-lg);
  }

  .matrix-toolbar > div:first-child {
    display: grid;
    gap: var(--spacing-2xs);
  }

  .matrix-toolbar span,
  .module-heading span,
  .track-module-summary span {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .matrix-grid {
    min-width: 0;
    overflow-x: auto;
    display: grid;
    grid-auto-columns: minmax(168px, 1fr);
    grid-auto-flow: column;
    gap: var(--spacing-sm);
    padding-bottom: var(--spacing-xs);
  }

  .matrix-track {
    min-width: 0;
    min-height: 360px;
    border-left: var(--border-width) solid var(--border);
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--surface-2);
  }

  .matrix-track.selected {
    border-left-color: var(--accent);
  }

  .matrix-track-header {
    min-width: 0;
    min-height: 58px;
    padding: var(--spacing-sm);
    border: 0;
    border-bottom: var(--border-width) solid var(--border);
    border-radius: 0;
    display: grid;
    gap: var(--spacing-2xs);
    text-align: left;
  }

  .matrix-track-header.selected {
    background: var(--accent-soft);
  }

  .matrix-track-header span,
  .matrix-clip span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 800;
  }

  .matrix-track-header small,
  .matrix-clip small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: var(--font-size-xs);
  }

  .matrix-clip-stack {
    align-content: start;
    display: grid;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm);
  }

  .matrix-clip,
  .matrix-add-clip {
    width: 100%;
    min-height: 68px;
    padding: var(--spacing-sm);
    border-radius: var(--radius-md);
  }

  .matrix-clip {
    display: grid;
    align-content: space-between;
    text-align: left;
    touch-action: manipulation;
    user-select: none;
  }

  .matrix-clip.active {
    border-color: var(--accent);
  }

  .matrix-clip.playing {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--surface-0);
  }

  .matrix-clip.playing small {
    color: var(--surface-0);
  }

  .matrix-clip.queued {
    border-color: var(--accent-strong);
    background: var(--accent-soft);
  }

  .matrix-add-clip {
    min-height: 42px;
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: var(--font-size-xl);
    font-weight: 800;
  }

  .track-modules {
    display: grid;
    grid-template-columns: minmax(140px, 0.7fr) minmax(260px, 1fr) minmax(360px, 1.4fr);
    gap: var(--spacing-lg);
  }

  .track-module {
    min-width: 0;
    padding: var(--spacing-compact);
    border: var(--border-width) solid var(--border);
    background: var(--surface);
    display: grid;
    gap: var(--spacing-sm);
  }

  .track-module-summary {
    align-content: center;
  }

  .track-module-summary strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--font-size-xl);
  }

  .module-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--spacing-sm);
  }

  .parameter-module-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--spacing-sm);
  }

  .module-control {
    min-width: 0;
    display: grid;
    gap: var(--spacing-2xs);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .module-control strong {
    color: var(--text);
    font-size: var(--font-size-xs);
  }

  .module-toggle {
    min-height: var(--control-height-sm);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
  }

  .module-toggle.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .audio-output-panel {
    display: grid;
    grid-template-columns:
      auto
      minmax(82px, 0.9fr)
      minmax(92px, 1fr)
      repeat(4, minmax(54px, 0.7fr));
    align-items: center;
    gap: var(--spacing-sm);
  }

  .audio-output-panel label {
    min-width: 0;
    display: grid;
    gap: var(--spacing-2xs);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .audio-output-panel select,
  .audio-output-panel input[type='range'] {
    min-width: 0;
    width: 100%;
  }

  .audio-toggle {
    grid-template-columns: auto auto;
    align-items: center;
  }

  .audio-enable-button {
    min-height: var(--control-height-sm);
    min-width: 44px;
    padding: 0 var(--spacing-sm);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
  }

  .audio-enable-button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  @media (max-width: 980px) {
    .track-modules {
      grid-template-columns: 1fr;
    }

    .parameter-module-grid,
    .audio-output-panel {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .clip-launch-controls {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--spacing-xs);
  }

  .clip-launch-controls button {
    min-width: 0;
    min-height: 26px;
    padding: 0 var(--spacing-xs);
    font-size: var(--font-size-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clip-launch-controls button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
</style>
