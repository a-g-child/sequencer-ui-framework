<script lang="ts">
  import { onMount, tick } from 'svelte'
  import {
    SequencerApplication,
    validateDocument,
    type SelectionItem,
    type ServiceEvent,
    type Parameter,
    type ParameterDefinition,
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
    type PianoRollNoteView,
    type PianoRollView
  } from './lib/editors/piano-roll/piano-roll-model'
  import { EDITORS } from './lib/editors/editor-registry';
  import type { EditorKind } from './lib/editors/editor-types';
  import {
    buildPatternGridLines,
    createGridDefinition,
    type PatternGridLine
  } from './lib/editors/pattern/pattern-grid';
  import { hitTestNote } from './lib/editors/pattern/pattern-hit-testing';
  import {
    clampViewport,
    panViewportX,
    panViewportY,
    resetViewport,
    zoomViewportX,
    type PatternNavigationBounds
  } from './lib/editors/pattern/pattern-navigation';
  import { buildPatternSelection } from './lib/editors/pattern/pattern-selection';
  import {
    beatToScreenX,
    createPatternViewport,
    durationToScreenWidth,
    patternLengthToScreenWidth,
    pitchRangeToScreenHeight,
    pitchToScreenY,
    screenXToBeat,
    screenYToPitch,
    snapBeat,
    type PatternViewport
  } from './lib/editors/pattern/pattern-viewport';
  import { DrawNoteTool } from './lib/editors/pattern/tools/draw-note-tool';
  import { EraseNoteTool } from './lib/editors/pattern/tools/erase-note-tool';
  import { MoveNoteTool } from './lib/editors/pattern/tools/move-note-tool';
  import { ResizeNoteTool } from './lib/editors/pattern/tools/resize-note-tool';
  import { SelectTool } from './lib/editors/pattern/tools/select-tool';
  import type {
    PatternInteractionContext,
    PatternOverlayNote,
    PatternTool
  } from './lib/editors/pattern/pattern-tool';

  

  const app = new SequencerApplication()
  const controller = new AppController(app)
  const store = app.documentStore
  controller.selectInitialTrack()
  const resizeNoteTool = new ResizeNoteTool();
  const beatsPerBar = 4;
  const minimumVisibleBars = 4;
  const minimumVisibleBeats = beatsPerBar * minimumVisibleBars;
  const patternGrid = createGridDefinition({ majorEvery: beatsPerBar });
  const patternTools: PatternTool[] = [
    new SelectTool(),
    new DrawNoteTool(),
    new EraseNoteTool(),
    new MoveNoteTool(),
    resizeNoteTool
  ];
  const middleCPitch = 60;
  const viewportZoomStep = 1.25;
  const viewportBeatScrollStep = 1;
  const viewportPitchScrollStep = 6;
  const minViewportZoom = 0.5;
  const maxViewportZoom = 4;

  onMount(() => {
    const unsubscribe = app.serviceEvents.subscribe(handleServiceEvent)
    window.addEventListener('keydown', handleKeyDown)
    void app.initialise()

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
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
  let activePatternTool = patternTools[0];
  let patternViewport: PatternViewport = resetViewport();
  let patternInteractionContext: PatternInteractionContext | undefined;
  let pianoRollScrollElement: HTMLDivElement | undefined;
  let isPanningPattern = false;
  let lastPanX = 0;
  let lastPanY = 0;
  let hoveredNoteId: string | undefined;
  let ghostBeat = 0;
  let ghostPitch = middleCPitch;
  let showGhost = false;
  let visiblePatternGridLines: PatternGridLine[] = pianoRoll
    ? buildPatternGridLines(visiblePianoRollLength(), patternGrid)
    : [];

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
    visiblePatternGridLines = pianoRoll
      ? buildPatternGridLines(visiblePianoRollLength(), patternGrid)
      : []
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

  function selectNote(note: PianoRollNoteView) {
    controller.selectNote(note)
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

  function setActivePatternTool(tool: PatternTool) {
    activePatternTool.cancel?.();
    activePatternTool = tool;
    refreshPatternOverlay();
  }

  function setPatternViewport(next: {
    zoomX?: number;
    zoomY?: number;
    scrollX?: number;
    scrollY?: number;
  }) {
    applyPatternViewport(createPatternViewport({
      zoomX: next.zoomX ?? patternViewport.zoomX,
      zoomY: next.zoomY ?? patternViewport.zoomY,
      scrollX: next.scrollX ?? patternViewport.scrollX,
      scrollY: next.scrollY ?? patternViewport.scrollY
    }));
  }

  function applyPatternViewport(next: PatternViewport) {
    patternViewport = clampViewport(next, patternNavigationBounds());
    refreshPatternOverlay();
  }

  function patternNavigationBounds(): PatternNavigationBounds {
    const scrollLimit = pianoRollScrollLimit();

    return {
      maxScrollX: visiblePianoRollLength(),
      minScrollY: -scrollLimit,
      maxScrollY: scrollLimit
    };
  }

  function visiblePianoRollLength(): number {
    return Math.max(pianoRoll?.length ?? 0, minimumVisibleBeats);
  }

  function zoomPatternViewportX(multiplier: number) {
    applyPatternViewport(
      zoomViewportX(patternViewport, multiplier, patternNavigationBounds())
    );
  }

  function zoomPatternViewportY(multiplier: number) {
    setPatternViewport({
      zoomY: clampNumber(
        patternViewport.zoomY * multiplier,
        minViewportZoom,
        maxViewportZoom
      )
    });
  }

  function scrollPatternViewport(deltaBeats: number) {
    applyPatternViewport(
      panViewportX(patternViewport, deltaBeats, patternNavigationBounds())
    );
  }

  function scrollPatternPitch(deltaSemitones: number) {
    applyPatternViewport(
      panViewportY(patternViewport, deltaSemitones, patternNavigationBounds())
    );
  }

  function resetPatternViewport() {
    applyPatternViewport(resetViewport());
    void tick().then(() => centerPianoRollScroll());
  }

  function pianoRollScrollLimit(): number {
    return pianoRoll ? pianoRoll.pitchCount : 0;
  }

  function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function noteHeight(): number {
    return Math.max(6, patternViewport.pixelsPerSemitone - 2);
  }

  function noteName(pitch: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(pitch / 12) - 1;

    return `${names[pitch % 12]}${octave}`;
  }

  function selectedPianoRollNotes(): PianoRollNoteView[] {
    if (!pianoRoll) return [];

    if (selected?.type !== 'note') return [];
    const selectedNoteId = selected.id;

    return pianoRoll.notes.filter((note) => note.id === selectedNoteId);
  }

  function patternSelection() {
    return buildPatternSelection(selectedPianoRollNotes());
  }

  function buildPatternInteractionContext(
    event: PointerEvent,
    hoveredNote?: PianoRollNoteView
  ): PatternInteractionContext | undefined {
    if (!pianoRoll) return undefined;

    const eventTarget = event.currentTarget as HTMLElement;
    const target = eventTarget.classList.contains('piano-roll')
      ? eventTarget
      : eventTarget.closest<HTMLElement>('.piano-roll');

    if (!target) return undefined;

    const rect = target.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top - target.clientTop;
    const time = snapBeat(screenXToBeat(x, patternViewport), patternGrid.snap);
    const detectedNote =
      hoveredNote ??
      hitTestNote(
        pianoRoll.notes,
        patternViewport,
        pianoRoll.highestPitch,
        x,
        y
      );

    const pitch = Math.max(
      pianoRoll.lowestPitch,
      Math.min(
        pianoRoll.highestPitch,
        screenYToPitch(y, patternViewport, pianoRoll.highestPitch)
      )
    );

    const selection = patternSelection();

    return {
      controller,
      patternId: pianoRoll.patternId,
      pointer: { x, y },
      musical: {
        beat: time,
        pitch,
        snap: patternGrid.snap
      },
      hoveredNote: detectedNote,
      selectedNotes: [
        ...(selection.primary ? [selection.primary] : []),
        ...selection.secondary
      ]
    };
  }

  function updatePatternHover(context: PatternInteractionContext) {
    hoveredNoteId = context.hoveredNote?.id;
    ghostBeat = context.musical.beat;
    ghostPitch = context.musical.pitch;
    showGhost = !context.hoveredNote;
  }

  function clearPatternHover() {
    hoveredNoteId = undefined;
    showGhost = false;
  }

  function refreshPatternOverlay() {
    patternInteractionContext = patternInteractionContext
      ? { ...patternInteractionContext }
      : undefined;
  }

  function patternOverlayNotes(): PatternOverlayNote[] {
    if (!patternInteractionContext) return [];
    if (activePatternTool.id === 'draw-note') return [];

    return activePatternTool.drawOverlay?.(patternInteractionContext)?.notes ?? [];
  }

  function handlePatternWheel(event: WheelEvent) {
    event.preventDefault();

    if (event.ctrlKey || event.metaKey) {
      applyPatternViewport(
        zoomViewportX(
          patternViewport,
          event.deltaY < 0 ? 1.1 : 0.9,
          patternNavigationBounds()
        )
      );
      return;
    }

    if (event.shiftKey) {
      applyPatternViewport(
        panViewportY(
          patternViewport,
          event.deltaY > 0 ? 2 : -2,
          patternNavigationBounds()
        )
      );
      return;
    }

    applyPatternViewport(
      panViewportX(
        patternViewport,
        event.deltaY / patternViewport.pixelsPerBeat,
        patternNavigationBounds()
      )
    );
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (activeEditor !== 'piano-roll' || isEditableEventTarget(event.target)) return;

    if (event.key === 'Home') {
      event.preventDefault();
      resetPatternViewport();
      return;
    }

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomPatternViewportX(1.1);
      return;
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomPatternViewportX(0.9);
    }
  }

  function isEditableEventTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;

    return Boolean(
      target.closest('input, textarea, select, [contenteditable="true"]')
    );
  }

  function beginPatternPan(event: PointerEvent): boolean {
    if (event.button !== 1) return false;

    event.preventDefault();
    clearPatternHover();
    isPanningPattern = true;
    lastPanX = event.clientX;
    lastPanY = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    return true;
  }

  function movePatternPan(event: PointerEvent): boolean {
    if (!isPanningPattern) return false;

    const dx = event.clientX - lastPanX;
    const dy = event.clientY - lastPanY;

    let nextViewport = panViewportX(
      patternViewport,
      -dx / patternViewport.pixelsPerBeat,
      patternNavigationBounds()
    );
    nextViewport = panViewportY(
      nextViewport,
      dy / patternViewport.pixelsPerSemitone,
      patternNavigationBounds()
    );
    applyPatternViewport(nextViewport);

    lastPanX = event.clientX;
    lastPanY = event.clientY;

    return true;
  }

  function endPatternPan(): boolean {
    if (!isPanningPattern) return false;

    isPanningPattern = false;
    return true;
  }

  function handlePianoRollPointerEnter(event: PointerEvent) {
    const context = buildPatternInteractionContext(event);

    if (!context) return;

    patternInteractionContext = context;
    updatePatternHover(context);
    activePatternTool.pointerEnter?.(context);
    refreshPatternOverlay();
  }

  function handlePianoRollPointerDown(event: PointerEvent) {
    if (beginPatternPan(event)) return;

    const context = buildPatternInteractionContext(event);

    if (!context) return;

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    patternInteractionContext = context;
    updatePatternHover(context);
    activePatternTool.pointerDown(context);

    syncView();
    refreshPatternOverlay();
  }

  function handlePianoRollPointerMove(event: PointerEvent) {
    if (movePatternPan(event)) return;

    const context = buildPatternInteractionContext(event);

    if (!context) return;

    patternInteractionContext = context;
    updatePatternHover(context);
    activePatternTool.pointerMove?.(context);
    refreshPatternOverlay();
  }

  function handlePianoRollPointerUp(event: PointerEvent) {
    if (endPatternPan()) return;

    const context = buildPatternInteractionContext(event);

    if (!context) return;

    patternInteractionContext = context;
    updatePatternHover(context);
    activePatternTool.pointerUp?.(context);
    syncView();
    refreshPatternOverlay();
  }

  function handlePianoRollPointerLeave(event: PointerEvent) {
    if (isPanningPattern) return;

    const context = buildPatternInteractionContext(event);

    if (!context) return;

    patternInteractionContext = context;
    clearPatternHover();
    activePatternTool.pointerLeave?.(context);

    if (!['move-note', 'resize-note'].includes(activePatternTool.id)) {
      patternInteractionContext = undefined;
    }

    refreshPatternOverlay();
  }

  function handleNotePointerDown(event: PointerEvent, note: PianoRollNoteView) {
    if (beginPatternPan(event)) return;

    const context = buildPatternInteractionContext(event, note);

    if (!context) return;

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    patternInteractionContext = context;
    updatePatternHover(context);
    activePatternTool.pointerDown(context);
    refreshPatternOverlay();

    if (!['move-note', 'resize-note'].includes(activePatternTool.id)) {
      syncView();
      refreshPatternOverlay();
    }
  }

  function handleNotePointerMove(event: PointerEvent, note: PianoRollNoteView) {
    if (movePatternPan(event)) return;

    const context = buildPatternInteractionContext(event, note);

    if (!context) return;

    patternInteractionContext = context;
    updatePatternHover(context);
    activePatternTool.pointerMove?.(context);
    refreshPatternOverlay();
  }

  function handleNotePointerUp(event: PointerEvent, note: PianoRollNoteView) {
    if (endPatternPan()) return;

    const context = buildPatternInteractionContext(event, note);

    if (!context) return;

    patternInteractionContext = context;
    updatePatternHover(context);
    activePatternTool.pointerUp?.(context);
    syncView();
    refreshPatternOverlay();
  }

  function centerPianoRollOnMiddleC(node: HTMLDivElement) {
    pianoRollScrollElement = node;
    centerPianoRollScroll();
  }

  function centerPianoRollScroll() {
    if (!pianoRollScrollElement) return;

    const middleCOffset =
      pitchToScreenY(middleCPitch, patternViewport, 127) -
      pianoRollScrollElement.clientHeight / 2;

    pianoRollScrollElement.scrollTop = Math.max(0, middleCOffset);
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

  function addC4Note() {
    if (!pianoRoll) return

    controller.createNote(pianoRoll.patternId, 0, 1, 60)
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

  function readBooleanValue(event: Event): boolean {
    return (event.currentTarget as HTMLInputElement).checked
  }

  function readTextValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value
  }

  function readChoiceValue(
    event: Event,
    definition: ParameterDefinition | undefined
  ): ParameterValue {
    const value = (event.currentTarget as HTMLSelectElement).value
    const option = definition?.options?.find((item) => String(item.value) === value)

    return option?.value ?? value
  }

  function formatParameterValue(parameter: Parameter): string {
    if (typeof parameter.value === 'boolean') {
      return parameter.value ? 'On' : 'Off'
    }

    return String(parameter.value)
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

<main class="editor-shell">
  <header class="topbar">
    <div>
      <p class="eyebrow">Sequencer</p>
      <h1>{store.document.name}</h1>
    </div>

    <div class="transport-panel" aria-label="Runtime transport">
      <div class="transport-buttons">
        <button type="button" on:click={playTransport} disabled={transportPlaying}>
          Play
        </button>
        <button type="button" on:click={stopTransport} disabled={!transportPlaying}>
          Stop
        </button>
      </div>

      <label class="bpm-control" for="runtime-bpm">
        <span>BPM</span>
        <input
          id="runtime-bpm"
          type="number"
          min="1"
          step="1"
          value={transportBpm}
          on:change={setRuntimeBpm}
        />
      </label>

      <div class="beat-readout">
        <span>Beat</span>
        <strong>{transportBeat.toFixed(2)}</strong>
      </div>
    </div>

    <div class="toolbar" aria-label="Document operations">
      <button type="button" on:click={addTrack}>Add Track</button>
      <button type="button" on:click={undo} disabled={!canUndo}>Undo</button>
      <button type="button" on:click={redo} disabled={!canRedo}>Redo</button>
    </div>
  </header>

  <section class="workspace" aria-label="Document workspace">
    <aside class="track-pane" aria-label="Tracks">
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
    </aside>

    <section class="inspector" aria-label="Inspector">
      <section class="timeline-panel" aria-label="Timeline">
        <div class="pane-heading">
          <h2>Timeline</h2>
          <span>{timeline.length} beats</span>
        </div>

    

        
      </section>
      <div class="editor-tabs">
        {#each EDITORS as editor}
          <button
            class:active={activeEditor === editor.id}
            on:click={() => activeEditor = editor.id}
          >
            {editor.name}
          </button>
        {/each}
      </div>
      {#if activeEditor === 'piano-roll'}
          {#if pianoRoll}
            <section class="piano-roll-panel" aria-label="Piano roll">
              <div class="pane-heading">
                <h2>Piano Roll</h2>
                <span>{pianoRoll.patternName}</span>
              </div>

              <div class="piano-roll-toolbar">
                <button type="button" on:click={addC4Note}>Add C4</button>
                <div class="viewport-controls" aria-label="Pattern viewport controls">
                  <button
                    type="button"
                    aria-label="Zoom time out"
                    on:click={() => zoomPatternViewportX(1 / viewportZoomStep)}
                  >
                    X -
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom time in"
                    on:click={() => zoomPatternViewportX(viewportZoomStep)}
                  >
                    X +
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom pitch out"
                    on:click={() => zoomPatternViewportY(1 / viewportZoomStep)}
                  >
                    Y -
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom pitch in"
                    on:click={() => zoomPatternViewportY(viewportZoomStep)}
                  >
                    Y +
                  </button>
                  <button
                    type="button"
                    aria-label="Scroll left"
                    on:click={() => scrollPatternViewport(-viewportBeatScrollStep)}
                  >
                    Left
                  </button>
                  <button
                    type="button"
                    aria-label="Scroll right"
                    on:click={() => scrollPatternViewport(viewportBeatScrollStep)}
                  >
                    Right
                  </button>
                  <button
                    type="button"
                    aria-label="Pitch up"
                    on:click={() => scrollPatternPitch(-viewportPitchScrollStep)}
                  >
                    Pitch +
                  </button>
                  <button
                    type="button"
                    aria-label="Pitch down"
                    on:click={() => scrollPatternPitch(viewportPitchScrollStep)}
                  >
                    Pitch -
                  </button>
                  <button
                    type="button"
                    aria-label="Reset view"
                    on:click={resetPatternViewport}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div
                class="piano-roll-frame"
              >
                <div
                  class="piano-roll-scroll"
                  bind:this={pianoRollScrollElement}
                  use:centerPianoRollOnMiddleC
                  on:wheel={handlePatternWheel}
                >
                  <div class="piano-roll-content">
                    <div class="piano-roll-ruler" aria-hidden="true">
                      <span>Note</span>
                      <div
                        class="piano-roll-ruler-track"
                        style={`width: ${patternLengthToScreenWidth(visiblePianoRollLength(), patternViewport)}px;`}
                      >
                        {#each visiblePatternGridLines.filter((line) => line.label) as marker}
                          <span style={`left: ${beatToScreenX(marker.beat, patternViewport)}px`}>
                            {marker.label}
                          </span>
                        {/each}
                      </div>
                    </div>

                    <div class="piano-roll-body">
                      <div
                        class="pitch-ruler"
                        style={`height: ${pitchRangeToScreenHeight(pianoRoll.pitchCount, patternViewport)}px;`}
                        aria-hidden="true"
                      >
                        {#each pianoRoll.pitchRows as pitch}
                          <span
                            class:c-note={pitch % 12 === 0}
                            style={`top: ${pitchToScreenY(pitch, patternViewport, pianoRoll.highestPitch) + patternViewport.pixelsPerSemitone / 2}px`}
                          >
                            {noteName(pitch)}
                          </span>
                        {/each}
                      </div>

                      <div
                        class="piano-roll"
                        class:panning={isPanningPattern}
                        role="application"
                        aria-label="Piano roll notes"
                        style={`width: ${patternLengthToScreenWidth(visiblePianoRollLength(), patternViewport)}px; height: ${pitchRangeToScreenHeight(pianoRoll.pitchCount, patternViewport)}px;`}
                        on:pointerenter={handlePianoRollPointerEnter}
                        on:pointerdown={handlePianoRollPointerDown}
                        on:pointermove={handlePianoRollPointerMove}
                        on:pointerup={handlePianoRollPointerUp}
                        on:pointerleave={handlePianoRollPointerLeave}
                        on:auxclick|preventDefault
                      >
                        <div class="piano-roll-grid" aria-hidden="true">
                          {#each visiblePatternGridLines as line}
                            <span
                              class:beat-line={line.isMajor}
                              style={`left: ${beatToScreenX(line.beat, patternViewport)}px`}
                            ></span>
                          {/each}

                          {#each pianoRoll.pitchRows as pitch}
                            <span
                              class="pitch-line"
                              style={`top: ${pitchToScreenY(pitch, patternViewport, pianoRoll.highestPitch)}px`}
                            ></span>
                          {/each}
                        </div>

                        {#if showGhost && activePatternTool.id === 'draw-note'}
                          <div
                            class="note-ghost"
                            style={`left: ${beatToScreenX(ghostBeat, patternViewport)}px; top: ${pitchToScreenY(ghostPitch, patternViewport, pianoRoll.highestPitch) + 1}px; width: ${durationToScreenWidth(patternGrid.snap, patternViewport)}px; height: ${noteHeight()}px;`}
                          ></div>
                        {/if}

                        {#each pianoRoll.notes as note (note.id)}
                          <button
                            type="button"
                            class="note"
                            class:selected={selected?.type === 'note' && selected.id === note.id}
                            class:hovered={hoveredNoteId === note.id}
                            class:resize-active={activePatternTool.id === 'resize-note'}
                            aria-label={`${noteName(note.pitch)} note at beat ${note.time}`}
                            style={`left: ${beatToScreenX(note.time, patternViewport)}px; width: ${durationToScreenWidth(note.duration, patternViewport)}px; height: ${noteHeight()}px; top: ${pitchToScreenY(note.pitch, patternViewport, pianoRoll.highestPitch) + 1}px;`}
                            on:pointerdown|stopPropagation={(event) =>
                              handleNotePointerDown(event, note)}
                            on:pointermove|stopPropagation={(event) =>
                              handleNotePointerMove(event, note)}
                            on:pointerup|stopPropagation={(event) =>
                              handleNotePointerUp(event, note)}
                            on:auxclick|preventDefault
                          >
                            {#if activePatternTool.id === 'resize-note'}
                              <span
                                class="note-resize-handle"
                                aria-label={`Resize ${noteName(note.pitch)} note`}
                                role="presentation"
                              ></span>
                            {/if}
                          </button>
                        {/each}

                        {#each patternOverlayNotes() as overlayNote (overlayNote.id)}
                          <div
                            class="note-overlay"
                            class:ghost={overlayNote.variant === 'ghost'}
                            style={`left: ${beatToScreenX(overlayNote.time, patternViewport)}px; width: ${durationToScreenWidth(overlayNote.duration, patternViewport)}px; height: ${noteHeight()}px; top: ${pitchToScreenY(overlayNote.pitch, patternViewport, pianoRoll.highestPitch) + 1}px;`}
                          ></div>
                        {/each}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          {/if}
        {:else if activeEditor === 'drum-rack'}
          <section class="panel">
            <h2>Drum Rack</h2>
            <p>Fixed-lane percussion editor placeholder.</p>
          </section>
        {:else if activeEditor === 'pattern-grid'}
          <section class="panel">
            <h2>Pattern Grid</h2>
            <p>Mono step sequencer with per-slot pitch placeholder.</p>
          </section>
        {:else if activeEditor === 'audio-graph'}
          <section class="panel">
            <h2>Audio Graph</h2>
            <p>Node-based routing and modulation placeholder.</p>
          </section>
        {/if}

      
      <div class="tool-tabs">
        {#each patternTools as tool}
          <button
            class:active={activePatternTool.id === tool.id}
            on:click={() => setActivePatternTool(tool)}
          >
            {tool.name}
          </button>
        {/each}
      </div>
      {#if inspector.type === 'track'}
        <div class="pane-heading">
          <h2>{inspector.title}</h2>
          <span>{selected?.type ?? 'track'}</span>
        </div>

        <form class="rename-form" on:submit|preventDefault={renameSelectedTrack}>
          <label for="track-name">Name</label>
          <div class="rename-row">
            <input id="track-name" bind:value={draftName} />
            <button type="submit">Rename</button>
          </div>
        </form>

        <div class="property-list">
          {#each inspector.properties as property (property.parameter.id)}
            <div class="property-row">
              <label for={`property-${property.parameter.id}`}>
                {property.definition.name}
              </label>

              {#if property.definition.kind === 'number' && typeof property.value === 'number'}
                <div class="number-property">
                  <input
                    id={`property-${property.parameter.id}`}
                    type="range"
                    min={property.definition.min}
                    max={property.definition.max}
                    step={property.definition.step}
                    value={property.value}
                    on:input={(event) =>
                      setNumberPreview(property.parameter.id, readNumberValue(event))}
                    on:change={(event) =>
                      commitNumberValue(property.parameter.id, readNumberValue(event))}
                  />
                  <input
                    aria-label={`${property.definition.name} value`}
                    type="number"
                    min={property.definition.min}
                    max={property.definition.max}
                    step={property.definition.step}
                    value={property.value}
                    on:input={(event) =>
                      setNumberPreview(property.parameter.id, readNumberValue(event))}
                    on:change={(event) =>
                      commitNumberValue(property.parameter.id, readNumberValue(event))}
                  />
                </div>
              {:else if property.definition.kind === 'boolean' && typeof property.value === 'boolean'}
                <input
                  id={`property-${property.parameter.id}`}
                  class="checkbox-property"
                  type="checkbox"
                  checked={property.value}
                  on:change={(event) =>
                    setParameterValue(property.parameter.id, readBooleanValue(event))}
                />
              {:else if property.definition.kind === 'choice'}
                <select
                  id={`property-${property.parameter.id}`}
                  value={String(property.value)}
                  on:change={(event) =>
                    setParameterValue(
                      property.parameter.id,
                      readChoiceValue(event, property.definition)
                    )}
                >
                  {#each property.definition.options ?? [] as option}
                    <option value={String(option.value)}>{option.label}</option>
                  {/each}
                </select>
              {:else if property.definition.kind === 'text' && typeof property.value === 'string'}
                <input
                  id={`property-${property.parameter.id}`}
                  value={property.value}
                  on:input={(event) =>
                    setParameterValue(property.parameter.id, readTextValue(event))}
                />
              {:else}
                <strong>{formatParameterValue(property.parameter)}</strong>
              {/if}
            </div>
          {/each}
        </div>
      {:else if inspector.type === 'placement' && inspector.placement}
        <div class="pane-heading">
          <h2>{inspector.title}</h2>
          <span>{inspector.placement.id}</span>
        </div>

        <div class="placement-inspector">
          <label>
            <span>Target Pattern</span>
            <input value={inspector.placement.targetPatternName} readonly />
          </label>

          <label>
            <span>Start</span>
            <input
              type="number"
              step="0.25"
              min="0"
              value={inspector.placement.start}
              on:change={(event) =>
                commitPlacementStart(readNumberValue(event))}
            />
          </label>

          <label>
            <span>Length</span>
            <input
              type="number"
              step="0.25"
              min="0.25"
              value={inspector.placement.length}
              on:change={(event) =>
                commitPlacementLength(readNumberValue(event))}
            />
          </label>

          <label>
            <span>Loop Count</span>
            <input
              type="number"
              step="1"
              min="1"
              value={inspector.placement.loopCount}
              on:change={(event) =>
                commitPlacementLoopCount(readNumberValue(event))}
            />
          </label>
        </div>
      {:else if inspector.type === 'note' && inspector.note}
        <div class="pane-heading">
          <h2>{inspector.title}</h2>
          <span>{inspector.note.id}</span>
        </div>

        <div class="placement-inspector">
          <label>
            <span>Pitch</span>
            <input
              type="number"
              step="1"
              min="0"
              max="127"
              value={inspector.note.pitch}
              on:change={(event) =>
                commitNotePitch(readNumberValue(event))}
            />
          </label>

          <label>
            <span>Start</span>
            <input
              type="number"
              step="0.25"
              min="0"
              value={inspector.note.time}
              on:change={(event) =>
                commitNoteTime(readNumberValue(event))}
            />
          </label>

          <label>
            <span>Length</span>
            <input
              type="number"
              step="0.25"
              min="0.25"
              value={inspector.note.duration}
              on:change={(event) =>
                commitNoteDuration(readNumberValue(event))}
            />
          </label>

          <label>
            <span>Velocity</span>
            <input value={inspector.note.velocity} readonly />
          </label>
        </div>

        <div class="inspector-actions">
          <button type="button" on:click={deleteSelectedNote}>Delete Note</button>
        </div>
      {:else}
        <div class="empty-state">
          <h2>No Selection</h2>
        </div>
      {/if}
    </section>
  </section>

  <section class="runtime-status" aria-label="Runtime service status">
    <div>
      <span>Editor Transport</span>
      <strong>{transportPlaying ? 'playing' : 'stopped'}</strong>
    </div>
    <div>
      <span>Tempo</span>
      <strong>{transportBpm}</strong>
    </div>
    <div>
      <span>Beat</span>
      <strong>{transportBeat.toFixed(2)}</strong>
    </div>
    <div>
      <span>Audio Engine</span>
      <strong>{audioEngineStatus}</strong>
    </div>
    <div>
      <span>MIDI</span>
      <strong>{midiStatus}</strong>
    </div>
    <div>
      <span>Preferences</span>
      <strong>{preferencesStatus}</strong>
    </div>
  </section>

  <footer class="statusbar">
    <span>{store.document.patterns.values().length} patterns</span>
    <span>{store.document.parameterDefinitions.values().length} property types</span>
    <span>{store.document.parameters.values().length} properties</span>
    <span class:ok={issues.length === 0}>{issues.length} issues</span>
  </footer>
</main>

<style>
  .editor-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .editor-tabs button.active {
    font-weight: 700;
  }
</style>
