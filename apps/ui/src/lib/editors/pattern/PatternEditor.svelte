<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AppController } from '../../app-controller';
  import { EDITORS } from '../editor-registry';
  import type { EditorKind } from '../editor-types';
  import type {
    PianoRollNoteView,
    PianoRollView
  } from '../piano-roll/piano-roll-model';
  import {
    buildPatternGridLines,
    createGridDefinition
  } from './pattern-grid';
  import { buildPatternInteractionContext as createPatternInteractionContext } from './pattern-interaction-builder';
  import { PatternInputState } from './pattern-input-state';
  import {
    clampViewport,
    panViewportX,
    panViewportY,
    resetViewport,
    zoomViewportX,
    type PatternNavigationBounds
  } from './pattern-navigation';
  import { handlePatternShortcut } from './pattern-shortcuts';
  import { buildPatternSelection } from './pattern-selection';
  import type {
    PatternInteractionContext,
    PatternOverlay,
    PatternNoteOverlay,
    PatternRectangleOverlay,
    PatternTool
  } from './pattern-tool';
  import {
    beatToScreenX,
    createPatternViewport,
    durationToScreenWidth,
    patternLengthToScreenWidth,
    pitchRangeToScreenHeight,
    pitchToScreenY,
    type PatternViewport
  } from './pattern-viewport';
  import PatternToolbar from './PatternToolbar.svelte';
  import { DrawNoteTool } from './tools/draw-note-tool';
  import { EraseNoteTool } from './tools/erase-note-tool';
  import { MoveNoteTool } from './tools/move-note-tool';
  import { ResizeNoteTool } from './tools/resize-note-tool';
  import { SelectTool } from './tools/select-tool';

  export let controller: AppController;
  export let pianoRoll: PianoRollView | undefined;
  export let activeEditor: EditorKind;
  export let onEditorChange: (editor: EditorKind) => void;
  export let syncView: () => void;

  const resizeNoteTool = new ResizeNoteTool();
  const beatsPerBar = 4;
  const minimumVisibleBars = 4;
  const minimumVisibleBeats = beatsPerBar * minimumVisibleBars;
  const patternGrid = createGridDefinition({ majorEvery: beatsPerBar });
  const patternInput = new PatternInputState();
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

  $: visiblePatternGridLines = pianoRoll
    ? buildPatternGridLines(visiblePianoRollLength(), patternGrid)
    : [];

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

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

    const selected = controller.store.selection.current();

    if (selected?.type !== 'note') return [];
    const selectedNoteIds = selected.ids ?? [selected.id];

    return pianoRoll.notes.filter((note) => selectedNoteIds.includes(note.id));
  }

  function isPianoRollNoteSelected(noteId: string): boolean {
    return selectedPianoRollNotes().some((note) => note.id === noteId);
  }

  function patternSelection() {
    return buildPatternSelection(selectedPianoRollNotes());
  }

  function buildPatternInteractionContext(
    event: PointerEvent,
    hoveredNote?: PianoRollNoteView
  ): PatternInteractionContext | undefined {
    if (!pianoRoll) return undefined;

    const selection = patternSelection();

    return createPatternInteractionContext({
      event,
      element: event.currentTarget as HTMLElement,
      controller,
      patternId: pianoRoll.patternId,
      input: patternInput,
      viewport: patternViewport,
      grid: patternGrid,
      pianoRoll,
      selectedNotes: [
        ...(selection.primary ? [selection.primary] : []),
        ...selection.secondary
      ],
      hoveredNote
    });
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

  function patternOverlays(): PatternOverlay[] {
    if (!patternInteractionContext) return [];
    if (activePatternTool.id === 'draw-note') return [];

    return activePatternTool.drawOverlay?.(patternInteractionContext) ?? [];
  }

  function patternOverlayNotes(): PatternNoteOverlay[] {
    return patternOverlays().filter(
      (overlay): overlay is PatternNoteOverlay => overlay.type === 'note'
    );
  }

  function patternOverlayRectangles(): PatternRectangleOverlay[] {
    return patternOverlays().filter(
      (overlay): overlay is PatternRectangleOverlay =>
        overlay.type === 'rectangle'
    );
  }

  function handlePatternWheel(event: WheelEvent) {
    event.preventDefault();
    patternInput.setKeyboardModifiers(event);

    if (patternInput.modifiers.primary) {
      applyPatternViewport(
        zoomViewportX(
          patternViewport,
          event.deltaY < 0 ? 1.1 : 0.9,
          patternNavigationBounds()
        )
      );
      return;
    }

    if (patternInput.modifiers.shift) {
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

    patternInput.setKeyboardModifiers(event);

    const handled = handlePatternShortcut(event, {
      controller,
      viewport: patternViewport,
      navigationBounds: patternNavigationBounds(),
      patternId: pianoRoll?.patternId,
      selectedNotes: selectedPianoRollNotes(),
      pasteTargetBeat: pasteTargetBeat(),
      applyViewport: applyPatternViewport,
      resetViewport: resetPatternViewport,
      syncView
    });

    if (handled) {
      event.preventDefault();
    }
  }

  function pasteTargetBeat(): number {
    return showGhost ? ghostBeat : controller.transportBeat;
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
    patternInput.setKeyboardModifiers(event);
    const context = buildPatternInteractionContext(event);

    if (!context) return;

    patternInteractionContext = context;
    updatePatternHover(context);
    activePatternTool.pointerEnter?.(context);
    refreshPatternOverlay();
  }

  function handlePianoRollPointerDown(event: PointerEvent) {
    patternInput.setKeyboardModifiers(event);
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
    patternInput.setKeyboardModifiers(event);
    if (movePatternPan(event)) return;

    const context = buildPatternInteractionContext(event);

    if (!context) return;

    patternInteractionContext = context;
    updatePatternHover(context);
    activePatternTool.pointerMove?.(context);
    refreshPatternOverlay();
  }

  function handlePianoRollPointerUp(event: PointerEvent) {
    patternInput.setKeyboardModifiers(event);
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
    patternInput.setKeyboardModifiers(event);
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
    patternInput.setKeyboardModifiers(event);
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
    patternInput.setKeyboardModifiers(event);
    if (movePatternPan(event)) return;

    const context = buildPatternInteractionContext(event, note);

    if (!context) return;

    patternInteractionContext = context;
    updatePatternHover(context);
    activePatternTool.pointerMove?.(context);
    refreshPatternOverlay();
  }

  function handleNotePointerUp(event: PointerEvent, note: PianoRollNoteView) {
    patternInput.setKeyboardModifiers(event);
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

  function addC4Note() {
    if (!pianoRoll) return;

    controller.createNote(pianoRoll.patternId, 0, 1, 60);
    syncView();
  }
</script>

<PatternToolbar
  editors={EDITORS}
  activeEditor={activeEditor}
  tools={patternTools}
  activeToolId={activePatternTool.id}
  onEditorChange={(editor) => {
    onEditorChange(editor);
  }}
  onToolChange={setActivePatternTool}
  onAddNote={addC4Note}
  onZoomIn={() => zoomPatternViewportX(viewportZoomStep)}
  onZoomOut={() => zoomPatternViewportX(1 / viewportZoomStep)}
  onZoomPitchIn={() => zoomPatternViewportY(viewportZoomStep)}
  onZoomPitchOut={() => zoomPatternViewportY(1 / viewportZoomStep)}
  onPanLeft={() => scrollPatternViewport(-viewportBeatScrollStep)}
  onPanRight={() => scrollPatternViewport(viewportBeatScrollStep)}
  onPitchUp={() => scrollPatternPitch(-viewportPitchScrollStep)}
  onPitchDown={() => scrollPatternPitch(viewportPitchScrollStep)}
  onResetView={resetPatternViewport}
/>

{#if activeEditor === 'piano-roll'}
  {#if pianoRoll}
    <section class="piano-roll-panel" aria-label="Piano roll">
      <div class="pane-heading">
        <h2>Piano Roll</h2>
        <span>{pianoRoll.patternName}</span>
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

                {#each patternOverlayRectangles() as overlay (overlay.id)}
                  <div
                    class="marquee-overlay"
                    style={`left: ${overlay.x}px; top: ${overlay.y}px; width: ${overlay.width}px; height: ${overlay.height}px;`}
                  ></div>
                {/each}

                {#each pianoRoll.notes as note (note.id)}
                  <button
                    type="button"
                    class="note"
                    class:selected={isPianoRollNoteSelected(note.id)}
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
