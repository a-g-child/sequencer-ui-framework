<script lang="ts">
  import type { PatternRenderModel } from './pattern-renderer';
  import PatternAutomationLane from './PatternAutomationLane.svelte';
  import PatternGrid from './PatternGrid.svelte';
  import PatternNotes, {
    type PatternNotePointerEventDetail
  } from './PatternNotes.svelte';
  import type { RenderInteractionItem } from '../../framework/editor';
  import PatternOverlays from './PatternOverlays.svelte';
  import PatternProbabilityLane from './PatternProbabilityLane.svelte';
  import PatternVelocityLane from './PatternVelocityLane.svelte';
  import {
    beatToScreenX,
    patternLengthToScreenWidth,
    pitchRangeToScreenHeight,
    pitchToScreenY
  } from './pattern-viewport';
  import type { PianoRollNoteView } from '../../editors/piano-roll/piano-roll-model';
  import type {
    AutomationCurvePoint,
    PatternAutomationTarget
  } from './pattern-automation';

  export let renderModel: PatternRenderModel;
  export let playheadBeat: number | undefined = undefined;
  export let height: string | number | undefined = undefined;
  export let width: string | number | undefined = undefined;
  export let showVelocityLane = false;
  export let showProbabilityLane = false;
  export let showAutomationLane = false;
  export let automationTargets: PatternAutomationTarget[] = [];
  export let selectedAutomationTargetId = '';
  export let automationPoints: AutomationCurvePoint[] = [];
  export let onAutomationTargetChange: (parameterId: string) => void;
  export let onAutomationPointsChange: (points: AutomationCurvePoint[]) => void;
  export let onAutomationPointsCommit: (points: AutomationCurvePoint[]) => void;
  export let onViewportWidthChange: (width: number) => void;
  export let onViewportHeightChange: (height: number) => void;
  export let onWheel: (event: WheelEvent) => void;
  export let onPointerEnter: (event: PointerEvent) => void;
  export let onPointerDown: (event: PointerEvent) => void;
  export let onPointerMove: (event: PointerEvent) => void;
  export let onPointerUp: (event: PointerEvent) => void;
  export let onPointerLeave: (event: PointerEvent) => void;
  export let onNotePointerDown: (
    event: PointerEvent,
    item: RenderInteractionItem<PianoRollNoteView>
  ) => void;
  export let onNotePointerMove: (
    event: PointerEvent,
    item: RenderInteractionItem<PianoRollNoteView>
  ) => void;
  export let onNotePointerUp: (
    event: PointerEvent,
    item: RenderInteractionItem<PianoRollNoteView>
  ) => void;
  export let onVelocityCommit: (
    note: PianoRollNoteView,
    velocity: number
  ) => void;
  export let onProbabilityCommit: (
    note: PianoRollNoteView,
    probability: number
  ) => void;

  const middleCPitch = 60;
  const velocityLaneOuterHeight = 72;

  let scrollElement: HTMLDivElement | undefined;
  let bodyScrollElement: HTMLDivElement | undefined;
  let activeScrollRendererId: string | undefined;
  let measuredViewportHeight: number | undefined;
  $: viewportHeight = toCssSize(measuredViewportHeight ?? height);
  $: editorWidth = patternLengthToScreenWidth(
    renderModel.visibleLength,
    renderModel.viewport
  );
  $: editorHeight = pitchRangeToScreenHeight(
    renderModel.pitchCount,
    renderModel.viewport
  );
  $: scrollStyle = buildScrollStyle(
    width,
    height,
    visibleAutomationLaneCount
  );
  $: visibleAutomationLaneCount =
    Number(showVelocityLane) +
    Number(showProbabilityLane) +
    Number(showAutomationLane);
  $: editorSurfaceStyle =
    `width: ${editorWidth}px; height: ${editorHeight}px;` +
    (viewportHeight ? ` min-height: ${viewportHeight};` : '');
  $: playheadX =
    playheadBeat === undefined
      ? undefined
      : beatToScreenX(playheadBeat, renderModel.viewport);
  $: showPlayhead =
    playheadBeat !== undefined &&
    playheadBeat >= 0 &&
    playheadBeat <= renderModel.visibleLength &&
    playheadX !== undefined &&
    playheadX >= 0 &&
    playheadX <= editorWidth;
  $: if (
    scrollElement &&
    bodyScrollElement &&
    renderModel.rendererId !== activeScrollRendererId
  ) {
    activeScrollRendererId = renderModel.rendererId;
    alignScrollToRenderer();
    measureViewportSize();
  }

  export function centerOnMiddleC() {
    if (!bodyScrollElement) return;
    if (renderModel.rendererId !== 'piano-roll') {
      bodyScrollElement.scrollTop = 0;
      return;
    }

    const middleCOffset =
      pitchToScreenY(middleCPitch, renderModel.viewport, 127) -
      bodyScrollElement.clientHeight / 2;

    bodyScrollElement.scrollTop = Math.max(0, middleCOffset);
  }

  function centerOnMount(node: HTMLDivElement) {
    scrollElement = node;
    measureViewportSize();

    const observer = new ResizeObserver(measureViewportSize);

    observer.observe(node);

    return {
      destroy() {
        observer.disconnect();
      }
    };
  }

  function alignScrollToRenderer() {
    if (!bodyScrollElement) return;

    if (renderModel.rendererId === 'piano-roll') {
      centerOnMiddleC();
      return;
    }

    bodyScrollElement.scrollTop = 0;
  }

  function toCssSize(value: string | number | undefined): string | undefined {
    if (value === undefined) return undefined;

    return typeof value === 'number' ? `${value}px` : value;
  }

  function buildScrollStyle(
    widthValue: string | number | undefined,
    heightValue: string | number | undefined,
    automationLaneCount: number
  ): string | undefined {
    const nextWidth = toCssSize(widthValue);
    const nextHeight = toExpandedHeight(
      heightValue,
      automationLaneCount * velocityLaneOuterHeight
    );
    const declarations: string[] = [];

    if (nextWidth) {
      declarations.push(`width: ${nextWidth}`);
    }

    if (nextHeight) {
      declarations.push(
        `height: ${nextHeight}`,
        `min-height: ${nextHeight}`,
        `max-height: ${nextHeight}`
      );
    }

    return declarations.length > 0 ? declarations.join('; ') : undefined;
  }

  function toExpandedHeight(
    value: string | number | undefined,
    extraPixels: number
  ): string | undefined {
    if (value === undefined) return undefined;

    if (typeof value === 'number') {
      return `${value + extraPixels}px`;
    }

    return extraPixels > 0 ? `calc(${value} + ${extraPixels}px)` : value;
  }

  function measureViewportSize() {
    if (!scrollElement) return;

    const noteSurface = scrollElement.querySelector('.piano-roll');
    const scrollBounds = scrollElement.getBoundingClientRect();
    const bodyBounds = bodyScrollElement?.getBoundingClientRect();
    const noteBounds = noteSurface?.getBoundingClientRect();
    const noteOffset = noteBounds ? noteBounds.left - scrollBounds.left : 0;
    const nextViewportHeight = readEditorViewportHeight(bodyBounds, scrollBounds);

    onViewportWidthChange(Math.max(0, scrollElement.clientWidth - noteOffset));
    if (nextViewportHeight !== measuredViewportHeight) {
      measuredViewportHeight = nextViewportHeight;
    }

    onViewportHeightChange(nextViewportHeight);
  }

  function readEditorViewportHeight(
    bodyBounds: DOMRect | undefined,
    scrollBounds: DOMRect
  ): number {
    const noteTopOffset = bodyBounds ? bodyBounds.top - scrollBounds.top : 0;
    const declaredHeight = readDeclaredEditorHeight();
    const availableHeight = (declaredHeight ?? scrollElement?.clientHeight ?? 0) -
      noteTopOffset;

    return Math.max(0, availableHeight);
  }

  function readDeclaredEditorHeight(): number | undefined {
    if (typeof height === 'number') return height;

    const parsedHeight = typeof height === 'string'
      ? Number.parseFloat(height)
      : Number.NaN;

    if (Number.isFinite(parsedHeight)) return parsedHeight;

    return undefined;
  }

  function handleNotePointerDown(
    event: CustomEvent<PatternNotePointerEventDetail>
  ): void {
    onNotePointerDown(event.detail.pointerEvent, event.detail.item);
  }

  function handleNotePointerMove(
    event: CustomEvent<PatternNotePointerEventDetail>
  ): void {
    onNotePointerMove(event.detail.pointerEvent, event.detail.item);
  }

  function handleNotePointerUp(
    event: CustomEvent<PatternNotePointerEventDetail>
  ): void {
    onNotePointerUp(event.detail.pointerEvent, event.detail.item);
  }
</script>

<div
  class="piano-roll-frame"
  class:sample-grid-frame={renderModel.rendererId === 'sample-grid'}
>
  <div
    class="piano-roll-scroll"
    bind:this={scrollElement}
    use:centerOnMount
    style={scrollStyle}
    on:wheel={onWheel}
  >
    <div class="piano-roll-content">
      <PatternGrid {renderModel} layer="ruler" />

      <div
        class="piano-roll-body"
        bind:this={bodyScrollElement}
        style={viewportHeight ? `--pattern-viewport-height: ${viewportHeight};` : undefined}
      >
        <PatternGrid {renderModel} layer="pitch-ruler" />

        <div
          class="piano-roll"
          class:sample-grid={renderModel.rendererId === 'sample-grid'}
          class:panning={renderModel.isPanning}
          role="application"
          aria-label={renderModel.rendererId === 'sample-grid' ? 'Sample grid notes' : 'Piano roll notes'}
          style={editorSurfaceStyle}
          on:pointerenter={onPointerEnter}
          on:pointerdown={onPointerDown}
          on:pointermove={onPointerMove}
          on:pointerup={onPointerUp}
          on:pointerleave={onPointerLeave}
          on:auxclick|preventDefault
        >
          <PatternGrid {renderModel} layer="background" />

          <PatternNotes
            {renderModel}
            on:pointerdown={handleNotePointerDown}
            on:pointermove={handleNotePointerMove}
            on:pointerup={handleNotePointerUp}
          />

          <PatternOverlays {renderModel} />

          {#if showPlayhead}
            <div
              class="pattern-playhead"
              aria-hidden="true"
              style={`transform: translateX(${playheadX}px);`}
            ></div>
          {/if}
        </div>
      </div>

      {#if showVelocityLane}
        <PatternVelocityLane {renderModel} {onVelocityCommit} />
      {/if}

      {#if showProbabilityLane}
        <PatternProbabilityLane {renderModel} {onProbabilityCommit} />
      {/if}

      {#if showAutomationLane}
        <PatternAutomationLane
          {renderModel}
          targets={automationTargets}
          selectedTargetId={selectedAutomationTargetId}
          points={automationPoints}
          onTargetChange={onAutomationTargetChange}
          onPointsChange={onAutomationPointsChange}
          onPointsCommit={onAutomationPointsCommit}
        />
      {/if}
    </div>
  </div>
</div>

<style>
  .pattern-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 5;
    width: 2px;
    pointer-events: none;
    background: var(--accent-strong);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--surface) 70%, transparent);
  }
</style>
