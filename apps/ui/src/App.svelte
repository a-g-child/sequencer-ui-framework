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
  import { AppController, type TrackClipView } from './lib/app-controller'
  import {
    buildInspectorView,
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
  import TimelinePanel from './lib/panels/TimelinePanel.svelte';
  import TransportPanel from './lib/panels/TransportPanel.svelte';

  

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

      return { parameter, definition }
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
    activeClipId = undefined
    syncView()
  }

  function selectClip(clip: TrackClipView) {
    activeClipId = clip.id
    syncView()
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
    const clipId = controller.createClipForTrack(selectedTrackId)

    if (clipId) {
      activeClipId = clipId
    }

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

  function undo() {
    controller.undo()
    syncView()
  }

  function redo() {
    controller.redo()
    syncView()
  }
</script>

<Workbench>
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
    />

    <div class="toolbar" aria-label="Document operations">
      <button type="button" on:click={addTrack}>Add Track</button>
      <button type="button" on:click={undo} disabled={!canUndo}>Undo</button>
      <button type="button" on:click={redo} disabled={!canRedo}>Redo</button>
    </div>
  </svelte:fragment>

  <svelte:fragment slot="left">
    <div class="pane-heading">
      <h2>Tracks</h2>
      <span>{tracks.length}</span>
    </div>

    <div class="track-list">
      {#each tracks as track (track.id)}
        <button
          type="button"
          class:selected={track.id === selectedTrackId}
          on:click={() => selectTrack(track)}
        >
          <span>{track.name}</span>
          <small>{track.parameters.length} properties</small>
        </button>
      {/each}
    </div>

    {#if selectedTrackId}
      <section class="clip-panel" aria-label="Selected track clips">
        <div class="pane-heading">
          <h2>Clips</h2>
          <button
            type="button"
            class="icon-button"
            aria-label="Add clip"
            title="Add clip"
            on:click={addClipToSelectedTrack}
          >
            +
          </button>
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

        <div class="clip-launch-status" aria-label="Clip launch status">
          <span>
            Launch quantize: {launchQuantizeLabel(playbackStatus.liveClips.launchQuantize)}
          </span>
          <span>Queued: {selectedTrackQueuedLaunch()}</span>
        </div>

        <div class="clip-list">
          {#each selectedTrackClips as clip (clip.id)}
            <div class:active={clip.active} class="clip-row">
              <button
                type="button"
                class:armed={clip.playbackActive}
                class:queued={clip.pendingLaunch}
                class="clip-active-badge"
                aria-pressed={clip.playbackActive || clip.pendingLaunch}
                aria-label={`Launch ${clip.name}`}
                title={clip.pendingLaunch
                  ? `Queued for beat ${formatBeat(clip.launchAtBeat)}`
                  : clip.playbackActive
                    ? 'Playback clip'
                    : 'Launch clip'}
                on:click={() => togglePlaybackActiveClip(clip)}
              >
                {#if clip.pendingLaunch}
                  {formatBeat(clip.launchAtBeat)}
                {:else if clip.playbackActive}
                  Play
                {:else}
                  Cue
                {/if}
              </button>

              <button
                type="button"
                class="clip-select"
                aria-pressed={clip.active}
                on:click={() => selectClip(clip)}
              >
                <span>{clip.name}</span>
                <small>Slot {clip.slotIndex + 1}</small>
              </button>

              <button
                type="button"
                class="clip-remove"
                aria-label={`Remove ${clip.name}`}
                title="Remove clip"
                on:click={() => removeClip(clip)}
              >
                &times;
              </button>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </svelte:fragment>
  
  <svelte:fragment slot="center">
    <!-- <TimelinePanel {timeline} /> -->
    <div class="editor-stack">
      <PatternEditor
        bars={1}
        beatsPerBar={4}
        height={360}
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
    </div>
  </svelte:fragment>

  

  <svelte:fragment slot="bottom">
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

    <footer class="statusbar">
      <span>{store.document.patterns.values().length} patterns</span>
      <span>{store.document.parameterDefinitions.values().length} property types</span>
      <span>{store.document.parameters.values().length} properties</span>
      <span class:ok={issues.length === 0}>{issues.length} issues</span>
    </footer>
  </svelte:fragment>
</Workbench>

<style>
  .editor-stack {
    display: grid;
    gap: var(--spacing-xl);
    min-width: 0;
  }

  .clip-panel {
    display: grid;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-lg);
  }

  .icon-button {
    width: 28px;
    height: 28px;
    padding: 0;
    display: inline-grid;
    place-items: center;
  }

  .clip-list {
    display: grid;
    gap: var(--spacing-xs);
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

  .clip-launch-status {
    display: grid;
    gap: var(--spacing-2xs);
    color: var(--muted);
    font-size: var(--font-size-xs);
    line-height: 1.35;
  }

  .clip-launch-status span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clip-row {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) 32px;
    align-items: stretch;
    gap: var(--spacing-xs);
  }

  .clip-active-badge {
    width: 48px;
    padding: 0 var(--spacing-xs);
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: var(--muted);
  }

  .clip-active-badge.armed {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--surface-0);
  }

  .clip-active-badge.queued {
    border-color: var(--accent-strong);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .clip-select {
    min-width: 0;
    display: grid;
    gap: 2px;
    justify-items: start;
    text-align: left;
  }

  .clip-select span,
  .clip-select small {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clip-row.active .clip-select {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .clip-remove {
    width: 32px;
    padding: 0;
  }
</style>
