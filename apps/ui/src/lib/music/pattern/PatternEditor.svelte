<script lang="ts">
  import {
    SetNoteProbabilityOperation,
    SetNoteVelocityOperation
  } from '@sequencer/music';
  import { onMount } from 'svelte';
  import type { AppController } from '../../app-controller';
  import type { GrooveSettings } from '@sequencer/core';
  import type { EditorKind } from '../../editors/editor-types';
  import type { PianoRollNoteView, PianoRollView } from '../../editors/piano-roll/piano-roll-model';
  import type { RenderInteractionItem } from '../../framework/editor';
  import PatternCanvas from './PatternCanvas.svelte';
  import { PatternEditorSession } from './PatternEditorSession';
  import {
    getLastPatternRenderModelBuildTimeMs
  } from './PatternRenderModelBuilder';
  import type {
    PatternPointerResult,
    PatternRendererId
  } from './PatternEditorSession';
  import type { SampleGridLane } from './pattern-renderer';
  import type { PatternScaleState } from './pattern-scale';
  import type {
    AutomationCurvePoint,
    PatternAutomationTarget
  } from './pattern-automation';
  import PatternToolbar from './PatternToolbar.svelte';

  export let controller: AppController;
  export let pianoRoll: PianoRollView | undefined;
  export let activeEditor: EditorKind;
  export let activeClipId: string | undefined = undefined;
  export let playheadBeat: number | undefined = undefined;
  export let clipLength: number | undefined = undefined;
  export let groove: GrooveSettings | undefined = undefined;
  export let onEditorChange: (editor: EditorKind) => void;
  export let onRenderModelRebuild: ((durationMs: number) => void) | undefined = undefined;
  export let syncView: () => void;
  export let height: string | number | undefined = undefined;
  export let width: string | number | undefined = undefined;
  export let bars: number | undefined = undefined;
  export let totalBars: number | undefined = undefined;
  export let beatsPerBar: number | undefined = undefined;
  export let beatDivisions: number | undefined = undefined;
  export let scale: PatternScaleState | undefined = undefined;
  export let automationTargets: PatternAutomationTarget[] = [];
  export let sampleGridLanes: SampleGridLane[] = [];

  let session: PatternEditorSession;
  let timelineRevision = '';
  export let showVelocityLane = false;
  export let showProbabilityLane = false;
  export let showAutomationLane = false;
  let selectedAutomationTargetId = '';
  let automationPointsByTarget: Record<string, AutomationCurvePoint[]> = {};
  let automationRevision = '';
  let sampleGridLaneRevision = '';
  let grooveRevision = '';
  let scaleRevision = '';

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
      beatDivisions,
      visibleLength: clipLength,
      groove
    });
    sampleGridLaneRevision = '';
    scaleRevision = '';
  }

  $: nextTimelineRevision =
    `${totalBars ?? bars ?? ''}:${beatsPerBar ?? ''}:${beatDivisions ?? ''}:${clipLength ?? ''}`;

  $: if (session && nextTimelineRevision !== timelineRevision) {
    timelineRevision = nextTimelineRevision;

    if (session.configureTimeline({ bars, totalBars, beatsPerBar, beatDivisions, visibleLength: clipLength })) {
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

  $: if (session && session.activeClipId !== activeClipId) {
    session.setActiveClip(activeClipId);
  }

  $: nextGrooveRevision =
    `${groove?.enabled ?? false}:${groove?.amount ?? 0}:${groove?.division ?? 0.25}`;
  $: if (session && nextGrooveRevision !== grooveRevision) {
    grooveRevision = nextGrooveRevision;
    session.setGroove(groove);
    invalidateSession();
  }

  $: nextScaleRevision =
    `${scale?.root ?? ''}:${scale?.scaleId ?? ''}:${scale?.mode ?? ''}`;
  $: if (session && scale && nextScaleRevision !== scaleRevision) {
    scaleRevision = nextScaleRevision;
    session.setScaleRoot(scale.root);
    session.setScaleId(scale.scaleId);
    session.setScaleMode(scale.mode);
    session.applyViewport(session.viewport, pianoRoll);
    invalidateSession();
  }

  $: nextSampleGridLaneRevision = sampleGridLanes
    .map((lane) => `${lane.pitch}:${lane.label}`)
    .join('|');
  $: if (session && nextSampleGridLaneRevision !== sampleGridLaneRevision) {
    sampleGridLaneRevision = nextSampleGridLaneRevision;
    session.setSampleGridLanes(sampleGridLanes);
    invalidateSession();
  }

  $: nextAutomationRevision =
    `${pianoRoll?.patternId ?? ''}:${selectedAutomationTargetId}`;
  $: if (
    controller &&
    pianoRoll &&
    selectedAutomationTargetId &&
    nextAutomationRevision !== automationRevision
  ) {
    automationRevision = nextAutomationRevision;
    automationPointsByTarget = {
      ...automationPointsByTarget,
      [selectedAutomationTargetId]: controller.patternAutomationPoints(
        pianoRoll.patternId,
        selectedAutomationTargetId
      )
    };
  }

  $: renderModel = session && pianoRoll
    ? session.buildRenderModel(pianoRoll)
    : undefined;
  $: if (renderModel && onRenderModelRebuild) {
    onRenderModelRebuild(getLastPatternRenderModelBuildTimeMs());
  }

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

  function handlePitchScrollChange(scrollY: number) {
    session.setViewport({ scrollY }, pianoRoll);
    invalidateSession();
  }

  function handleHorizontalScrollChange(scrollX: number) {
    session.setViewport({ scrollX }, pianoRoll);
    invalidateSession();
  }

  function handleViewportZoomXChange(zoomX: number) {
    session.setViewport({ zoomX }, pianoRoll);
    invalidateSession();
  }

  function handleViewportZoomYChange(zoomY: number) {
    session.setViewport({ zoomY }, pianoRoll);
    invalidateSession();
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

  function commitAutomationPoints(points: AutomationCurvePoint[]) {
    if (!pianoRoll || !selectedAutomationTargetId) return;

    if (
      controller.setPatternAutomationPoints(
        pianoRoll.patternId,
        selectedAutomationTargetId,
        points
      )
    ) {
      syncView();
      invalidateSession();
    }
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
        {renderModel}
        {playheadBeat}
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
        onAutomationPointsCommit={commitAutomationPoints}
        onViewportWidthChange={handleViewportWidthChange}
        onViewportHeightChange={handleViewportHeightChange}
        onHorizontalScrollChange={handleHorizontalScrollChange}
        onPitchScrollChange={handlePitchScrollChange}
        onViewportZoomXChange={handleViewportZoomXChange}
        onViewportZoomYChange={handleViewportZoomYChange}
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
    {/if}
  </section>
{/if}
