<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AppController } from '../../app-controller';
  import type { EditorKind } from '../../editors/editor-types';
  import type { PianoRollNoteView, PianoRollView } from '../../editors/piano-roll/piano-roll-model';
  import PatternCanvas from './PatternCanvas.svelte';
  import { PatternEditorSession } from './PatternEditorSession';
  import type {
    PatternPointerResult,
    PatternRendererId
  } from './PatternEditorSession';
  import PatternToolbar from './PatternToolbar.svelte';
  import PatternViewControls from './PatternViewControls.svelte';

  export let controller: AppController;
  export let pianoRoll: PianoRollView | undefined;
  export let activeEditor: EditorKind;
  export let onEditorChange: (editor: EditorKind) => void;
  export let syncView: () => void;
  export let height: string | number | undefined = undefined;
  export let width: string | number | undefined = undefined;
  export let bars: number | undefined = undefined;
  export let totalBars: number | undefined = undefined;
  export let beatsPerBar: number | undefined = undefined;
  export let beatDivisions: number | undefined = undefined;

  const viewportZoomStep = 1.25;
  const viewportBeatScrollStep = 1;
  const viewportPitchScrollStep = 6;

  let session: PatternEditorSession;
  let patternCanvas: PatternCanvas | undefined;
  let timelineRevision = '';

  $: if (controller && (!session || session.controller !== controller)) {
    session = new PatternEditorSession({
      controller,
      bars,
      totalBars,
      beatsPerBar,
      beatDivisions
    });
  }

  $: nextTimelineRevision =
    `${totalBars ?? bars ?? ''}:${beatsPerBar ?? ''}:${beatDivisions ?? ''}`;

  $: if (session && nextTimelineRevision !== timelineRevision) {
    timelineRevision = nextTimelineRevision;

    if (session.configureTimeline({ bars, totalBars, beatsPerBar, beatDivisions })) {
      session.applyViewport(session.viewport, pianoRoll);
      invalidateSession();
    }
  }

  $: if (
    session &&
    isRendererEditor(activeEditor) &&
    activeEditor !== session.activeRendererId
  ) {
    session.setActiveRenderer(activeEditor);
    invalidateSession();
  }

  $: renderModel = session && pianoRoll
    ? session.buildRenderModel(pianoRoll)
    : undefined;

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  function handleKeyDown(event: KeyboardEvent) {
    if (!isRendererEditor(activeEditor)) return;

    session.handleKeyDown(event, { pianoRoll, syncView });
    invalidateSession();
  }

  function invalidateSession() {
    session = session;
  }

  function applyPointerResult(result: PatternPointerResult) {
    if (result.syncView) {
      syncView();
    }

    invalidateSession();
  }

  function addC4Note() {
    if (session.createC4Note(pianoRoll)) {
      syncView();
      invalidateSession();
    }
  }

  function resetPatternViewport() {
    session.resetViewport(pianoRoll);
    invalidateSession();
    void tick().then(() => patternCanvas?.centerOnMiddleC());
  }

  function handlePatternWheel(event: WheelEvent) {
    session.handleWheel(event, pianoRoll);
    invalidateSession();
  }

  function handleViewportWidthChange(width: number) {
    if (session.setViewportWidth(width, pianoRoll)) {
      invalidateSession();
    }
  }

  function handlePianoRollPointerEnter(event: PointerEvent) {
    applyPointerResult(session.handlePointerEnter(event, pianoRoll));
  }

  function handlePianoRollPointerDown(event: PointerEvent) {
    applyPointerResult(session.handlePointerDown(event, pianoRoll));
  }

  function handlePianoRollPointerMove(event: PointerEvent) {
    applyPointerResult(session.handlePointerMove(event, pianoRoll));
  }

  function handlePianoRollPointerUp(event: PointerEvent) {
    applyPointerResult(session.handlePointerUp(event, pianoRoll));
  }

  function handlePianoRollPointerLeave(event: PointerEvent) {
    applyPointerResult(session.handlePointerLeave(event, pianoRoll));
  }

  function handleNotePointerDown(event: PointerEvent, note: PianoRollNoteView) {
    applyPointerResult(session.handleNotePointerDown(event, pianoRoll, note));
  }

  function handleNotePointerMove(event: PointerEvent, note: PianoRollNoteView) {
    applyPointerResult(session.handleNotePointerMove(event, pianoRoll, note));
  }

  function handleNotePointerUp(event: PointerEvent, note: PianoRollNoteView) {
    applyPointerResult(session.handleNotePointerUp(event, pianoRoll, note));
  }

  function isRendererEditor(editor: EditorKind): editor is PatternRendererId {
    return editor === 'piano-roll' || editor === 'drum-rack';
  }
</script>

{#if session}
  <section class="pattern-editor-panel" aria-label="Pattern editor">
    <PatternToolbar
      renderers={session.renderers}
      activeRendererId={session.activeRendererId}
      tools={session.tools}
      activeToolId={session.activeTool.id}
      onRendererChange={(rendererId) => {
        session.setActiveRenderer(rendererId);
        onEditorChange(rendererId);
        invalidateSession();
      }}
      onToolChange={(tool) => {
        session.setActiveTool(tool);
        invalidateSession();
      }}
    />

    {#if renderModel}
      <!-- <div class="pane-heading">
        <h2>Piano Roll</h2>
        <span>{renderModel.patternName}</span>
      </div> -->

      <PatternCanvas
        bind:this={patternCanvas}
        {renderModel}
        {height}
        {width}
        onViewportWidthChange={handleViewportWidthChange}
        onWheel={handlePatternWheel}
        onPointerEnter={handlePianoRollPointerEnter}
        onPointerDown={handlePianoRollPointerDown}
        onPointerMove={handlePianoRollPointerMove}
        onPointerUp={handlePianoRollPointerUp}
        onPointerLeave={handlePianoRollPointerLeave}
        onNotePointerDown={handleNotePointerDown}
        onNotePointerMove={handleNotePointerMove}
        onNotePointerUp={handleNotePointerUp}
      />

      <PatternViewControls
        onAddNote={addC4Note}
        onZoomIn={() => {
          session.zoomViewportX(viewportZoomStep, pianoRoll);
          invalidateSession();
        }}
        onZoomOut={() => {
          session.zoomViewportX(1 / viewportZoomStep, pianoRoll);
          invalidateSession();
        }}
        onZoomPitchIn={() => {
          session.zoomViewportY(viewportZoomStep, pianoRoll);
          invalidateSession();
        }}
        onZoomPitchOut={() => {
          session.zoomViewportY(1 / viewportZoomStep, pianoRoll);
          invalidateSession();
        }}
        onPanLeft={() => {
          session.scrollViewport(-viewportBeatScrollStep, pianoRoll);
          invalidateSession();
        }}
        onPanRight={() => {
          session.scrollViewport(viewportBeatScrollStep, pianoRoll);
          invalidateSession();
        }}
        onPitchUp={() => {
          session.scrollPitch(-viewportPitchScrollStep, pianoRoll);
          invalidateSession();
        }}
        onPitchDown={() => {
          session.scrollPitch(viewportPitchScrollStep, pianoRoll);
          invalidateSession();
        }}
        onResetView={resetPatternViewport}
      />
    {/if}
  </section>
{/if}
