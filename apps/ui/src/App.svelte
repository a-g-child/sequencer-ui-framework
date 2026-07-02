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
  import { AppController } from './lib/app-controller'
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
  import Workbench from './lib/framework/application/Workbench.svelte';
  import InspectorPanel from './lib/panels/InspectorPanel.svelte';
  import RuntimePanel from './lib/panels/RuntimePanel.svelte';
  import TimelinePanel from './lib/panels/TimelinePanel.svelte';
  import TransportPanel from './lib/panels/TransportPanel.svelte';

  

  const app = new SequencerApplication()
  const controller = new AppController(app)
  const store = app.documentStore
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
  let pianoRoll: PianoRollView | undefined = activePattern
    ? buildPianoRollView(activePattern)
    : undefined
  let draftName = inspector.type === 'track' ? inspector.title : ''
  let numberDrafts: Record<string, number> = {}
  let transportPlaying = app.editorTransport.playing
  let transportBpm = app.editorTransport.bpm
  let transportBeat = app.editorTransport.currentBeat
  let audioEngineStatus = 'idle'
  let midiStatus = 'idle'
  let preferencesStatus = 'not loaded'
  let issues = validateDocument(store.document)
  let canUndo = store.history.canUndo()
  let canRedo = store.history.canRedo()
  let activeEditor: EditorKind = 'piano-roll';
  function rebuildInspector() {
    selected = store.selection.current()
    selectedTrackId = selected?.type === 'track' ? selected.id : ''
    inspector = buildInspectorView(store)
    draftName = inspector.type === 'track' ? inspector.title : ''
  }

  function syncView() {
    tracks = store.document.tracks.values()
    timeline = buildTimelineView(store)
    activePattern = activePattern
      ? store.document.patterns.find(activePattern.id)
      : store.document.patterns.values()[0]
    pianoRoll = activePattern ? buildPianoRollView(activePattern) : undefined
    rebuildInspector()
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

  function selectTrack(track: Track) {
    controller.selectTrack(track)
    rebuildInspector()
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
        onEditorChange={(editor) => {
          activeEditor = editor;
          syncView();
        }}
        {syncView}
      />

      <InspectorPanel
        {inspector}
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
</style>
