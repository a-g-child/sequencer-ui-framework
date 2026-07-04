<script lang="ts">
  import {
    QuantizeNotesOperation,
    SetNoteHumanizeOffsetsOperation,
    SetNoteProbabilityOperation,
    SetNoteVelocityOperation
  } from '@sequencer/music';
  import { onMount, tick } from 'svelte';
  import type { AppController } from '../../app-controller';
  import type { EditorKind } from '../../editors/editor-types';
  import type { PianoRollNoteView, PianoRollView } from '../../editors/piano-roll/piano-roll-model';
  import type { RenderInteractionItem } from '../../framework/editor';
  import PatternCanvas from './PatternCanvas.svelte';
  import { PatternEditorSession } from './PatternEditorSession';
  import type {
    PatternPointerResult,
    PatternRendererId
  } from './PatternEditorSession';
  import type { PatternScaleMode } from './pattern-scale';
  import type {
    AutomationCurvePoint,
    PatternAutomationTarget
  } from './pattern-automation';
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
  export let automationTargets: PatternAutomationTarget[] = [];

  const viewportZoomStep = 1.25;
  const viewportBeatScrollStep = 1;
  const viewportPitchScrollStep = 6;
  const randomHumanizeRange = 0.06;

  let session: PatternEditorSession;
  let patternCanvas: PatternCanvas | undefined;
  let timelineRevision = '';
  let showVelocityLane = false;
  let showProbabilityLane = false;
  let showAutomationLane = false;
  let selectedAutomationTargetId = '';
  let automationPointsByTarget: Record<string, AutomationCurvePoint[]> = {};

  $: if (
    automationTargets.length > 0 &&
    !automationTargets.some((target) => target.parameter.id === selectedAutomationTargetId)
  ) {
    selectedAutomationTargetId = automationTargets[0].parameter.id;
  }

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

  function handleViewportHeightChange(height: number) {
    if (session.setViewportHeight(height, pianoRoll)) {
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

  function handleNotePointerDown(
    event: PointerEvent,
    item: RenderInteractionItem<PianoRollNoteView>
  ) {
    applyPointerResult(session.handleNotePointerDown(event, pianoRoll, item));
  }

  function handleNotePointerMove(
    event: PointerEvent,
    item: RenderInteractionItem<PianoRollNoteView>
  ) {
    applyPointerResult(session.handleNotePointerMove(event, pianoRoll, item));
  }

  function handleNotePointerUp(
    event: PointerEvent,
    item: RenderInteractionItem<PianoRollNoteView>
  ) {
    applyPointerResult(session.handleNotePointerUp(event, pianoRoll, item));
  }

  function commitNoteVelocity(note: PianoRollNoteView, velocity: number) {
    controller.execute(
      new SetNoteVelocityOperation(note.patternId, note.id, velocity)
    );
    syncView();
    invalidateSession();
  }

  function commitNoteProbability(
    note: PianoRollNoteView,
    probability: number
  ) {
    controller.execute(
      new SetNoteProbabilityOperation(note.patternId, note.id, probability)
    );
    syncView();
    invalidateSession();
  }

  function toggleVelocityLane() {
    showVelocityLane = !showVelocityLane;
  }

  function toggleProbabilityLane() {
    showProbabilityLane = !showProbabilityLane;
  }

  function toggleAutomationLane() {
    showAutomationLane = !showAutomationLane;
  }

  function setAutomationTarget(parameterId: string) {
    selectedAutomationTargetId = parameterId;
  }

  function setAutomationPoints(points: AutomationCurvePoint[]) {
    if (!selectedAutomationTargetId) return;

    automationPointsByTarget = {
      ...automationPointsByTarget,
      [selectedAutomationTargetId]: points
    };
  }

  function setScaleRoot(root: number) {
    session.setScaleRoot(root);
    session.applyViewport(session.viewport, pianoRoll);
    invalidateSession();
  }

  function setScaleId(scaleId: string) {
    session.setScaleId(scaleId);
    session.applyViewport(session.viewport, pianoRoll);
    invalidateSession();
  }

  function setScaleMode(mode: PatternScaleMode) {
    session.setScaleMode(mode);
    session.applyViewport(session.viewport, pianoRoll);
    invalidateSession();
  }

  function humanizeSelectedNotes() {
    if (!pianoRoll) return;

    const selectedNotes = session.selectedNotes(pianoRoll);

    if (selectedNotes.length === 0) return;

    controller.execute(
      new SetNoteHumanizeOffsetsOperation(
        pianoRoll.patternId,
        selectedNotes.map((note) => ({
          id: note.id,
          offset: randomHumanizeOffset(note.time)
        }))
      )
    );
    syncView();
    invalidateSession();
  }

  function quantizeSelectedNotes() {
    if (!pianoRoll) return;

    const selectedNotes = session.selectedNotes(pianoRoll);

    if (selectedNotes.length === 0) return;

    controller.execute(
      new QuantizeNotesOperation(
        pianoRoll.patternId,
        selectedNotes.map((note) => note.id),
        session.grid.snap
      )
    );
    syncView();
    invalidateSession();
  }

  function randomHumanizeOffset(noteTime: number): number {
    const offset = (Math.random() * 2 - 1) * randomHumanizeRange;

    return Math.max(-noteTime, offset);
  }

  function isRendererEditor(editor: EditorKind): editor is PatternRendererId {
    return editor === 'piano-roll' || editor === 'sample-grid';
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
        {showVelocityLane}
        {showProbabilityLane}
        {showAutomationLane}
        {automationTargets}
        {selectedAutomationTargetId}
        automationPoints={automationPointsByTarget[selectedAutomationTargetId] ?? []}
        onAutomationTargetChange={setAutomationTarget}
        onAutomationPointsChange={setAutomationPoints}
        onViewportWidthChange={handleViewportWidthChange}
        onViewportHeightChange={handleViewportHeightChange}
        onWheel={handlePatternWheel}
        onPointerEnter={handlePianoRollPointerEnter}
        onPointerDown={handlePianoRollPointerDown}
        onPointerMove={handlePianoRollPointerMove}
        onPointerUp={handlePianoRollPointerUp}
        onPointerLeave={handlePianoRollPointerLeave}
        onNotePointerDown={handleNotePointerDown}
        onNotePointerMove={handleNotePointerMove}
        onNotePointerUp={handleNotePointerUp}
        onVelocityCommit={commitNoteVelocity}
        onProbabilityCommit={commitNoteProbability}
      />

      <PatternViewControls
        onAddNote={addC4Note}
        {showVelocityLane}
        onToggleVelocityLane={toggleVelocityLane}
        {showProbabilityLane}
        onToggleProbabilityLane={toggleProbabilityLane}
        {showAutomationLane}
        onToggleAutomationLane={toggleAutomationLane}
        onQuantizeSelected={quantizeSelectedNotes}
        onHumanizeSelected={humanizeSelectedNotes}
        scale={session.activeRendererId === 'piano-roll' ? session.scale : undefined}
        onScaleRootChange={setScaleRoot}
        onScaleIdChange={setScaleId}
        onScaleModeChange={setScaleMode}
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
