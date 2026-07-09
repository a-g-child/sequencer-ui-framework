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
    pitchRangeToScreenHeight
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
  export let onHorizontalScrollChange: (scrollX: number) => void;
  export let onPitchScrollChange: (scrollY: number) => void;
  export let onViewportZoomXChange: (zoomX: number) => void;
  export let onViewportZoomYChange: (zoomY: number) => void;
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
  const minZoomX = 20 / 96;
  const maxZoomX = 400 / 96;
  const minZoomY = 6 / 20;
  const maxZoomY = 80 / 20;

  let scrollElement: HTMLDivElement | undefined;
  let bodyScrollElement: HTMLDivElement | undefined;
  let activeScrollRendererId: string | undefined;
  let measuredViewportHeight: number | undefined;
  let measuredViewportWidth = 0;
  let measuredScrollWidth = 0;
  let horizontalDrag:
    | {
        pointerId: number;
        startClientX: number;
        startScrollX: number;
      }
    | undefined;
  let verticalDrag:
    | {
        pointerId: number;
        startClientY: number;
        startScrollY: number;
      }
    | undefined;
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
  $: contentStyle =
    measuredScrollWidth > 0
      ? `--pattern-scroll-viewport-width: ${measuredScrollWidth}px;`
      : undefined;
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
  $: horizontalMaxScroll = Math.max(
    0,
    renderModel.visibleLength -
      measuredViewportWidth / renderModel.viewport.pixelsPerBeat
  );
  $: horizontalThumbPercent =
    editorWidth <= 0 || measuredViewportWidth <= 0
      ? 100
      : Math.min(100, Math.max(12, (measuredViewportWidth / editorWidth) * 100));
  $: horizontalThumbLeftPercent =
    horizontalMaxScroll <= 0
      ? 0
      : ((renderModel.viewport.scrollX / horizontalMaxScroll) *
          (100 - horizontalThumbPercent));
  $: verticalViewportHeight = measuredViewportHeight ?? 0;
  $: verticalMaxScroll = Math.max(
    0,
    renderModel.pitchCount -
      verticalViewportHeight / renderModel.viewport.pixelsPerSemitone
  );
  $: verticalThumbPercent =
    editorHeight <= 0 || verticalViewportHeight <= 0
      ? 100
      : Math.min(100, Math.max(12, (verticalViewportHeight / editorHeight) * 100));
  $: verticalThumbTopPercent =
    verticalMaxScroll <= 0
      ? 0
      : ((renderModel.viewport.scrollY / verticalMaxScroll) *
          (100 - verticalThumbPercent));
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
      onPitchScrollChange(0);
      return;
    }

    const middleCOffset =
      (renderModel.highestPitch - middleCPitch) *
        renderModel.viewport.pixelsPerSemitone -
      bodyScrollElement.clientHeight / 2;

    onPitchScrollChange(
      Math.max(0, middleCOffset) / renderModel.viewport.pixelsPerSemitone
    );
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

    onPitchScrollChange(0);
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

    measuredScrollWidth = scrollElement.clientWidth;

    const nextViewportWidth = Math.max(0, measuredScrollWidth - noteOffset);

    measuredViewportWidth = nextViewportWidth;
    onViewportWidthChange(nextViewportWidth);
    if (nextViewportHeight !== measuredViewportHeight) {
      measuredViewportHeight = nextViewportHeight;
    }

    onViewportHeightChange(nextViewportHeight);
  }

  function beginHorizontalScroll(event: PointerEvent) {
    if (horizontalMaxScroll <= 0) return;

    const target = event.currentTarget as HTMLElement;

    horizontalDrag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollX: renderModel.viewport.scrollX
    };
    target.setPointerCapture(event.pointerId);
  }

  function dragHorizontalScroll(event: PointerEvent) {
    if (!horizontalDrag || horizontalDrag.pointerId !== event.pointerId) return;
    if (measuredViewportWidth <= 0) return;

    const deltaPixels = event.clientX - horizontalDrag.startClientX;
    const track = (event.currentTarget as HTMLElement).parentElement;
    const trackWidth = track?.getBoundingClientRect().width ?? 0;
    const availableTrackWidth = Math.max(
      1,
      trackWidth * (1 - horizontalThumbPercent / 100)
    );
    const deltaBeats = (deltaPixels / availableTrackWidth) * horizontalMaxScroll;

    onHorizontalScrollChange(
      clampNumber(horizontalDrag.startScrollX + deltaBeats, 0, horizontalMaxScroll)
    );
  }

  function endHorizontalScroll(event: PointerEvent) {
    if (!horizontalDrag || horizontalDrag.pointerId !== event.pointerId) return;

    horizontalDrag = undefined;
  }

  function jumpHorizontalScroll(event: PointerEvent) {
    if (horizontalMaxScroll <= 0) return;
    if ((event.target as HTMLElement).classList.contains('pattern-x-scroll-thumb')) {
      return;
    }

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    const centeredRatio =
      (localX - (horizontalThumbPercent / 100) * bounds.width / 2) /
      Math.max(1, bounds.width * (1 - horizontalThumbPercent / 100));

    onHorizontalScrollChange(
      clampNumber(centeredRatio * horizontalMaxScroll, 0, horizontalMaxScroll)
    );
  }

  function handleHorizontalKeydown(event: KeyboardEvent) {
    if (horizontalMaxScroll <= 0) return;

    const smallStep = renderModel.grid.snap;
    const pageStep = Math.max(
      smallStep,
      measuredViewportWidth / renderModel.viewport.pixelsPerBeat
    );
    let nextScrollX = renderModel.viewport.scrollX;

    if (event.key === 'ArrowLeft') {
      nextScrollX -= smallStep;
    } else if (event.key === 'ArrowRight') {
      nextScrollX += smallStep;
    } else if (event.key === 'PageUp') {
      nextScrollX -= pageStep;
    } else if (event.key === 'PageDown') {
      nextScrollX += pageStep;
    } else if (event.key === 'Home') {
      nextScrollX = 0;
    } else if (event.key === 'End') {
      nextScrollX = horizontalMaxScroll;
    } else {
      return;
    }

    event.preventDefault();
    onHorizontalScrollChange(clampNumber(nextScrollX, 0, horizontalMaxScroll));
  }

  function beginVerticalScroll(event: PointerEvent) {
    if (verticalMaxScroll <= 0) return;

    const target = event.currentTarget as HTMLElement;

    verticalDrag = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startScrollY: renderModel.viewport.scrollY
    };
    target.setPointerCapture(event.pointerId);
  }

  function dragVerticalScroll(event: PointerEvent) {
    if (!verticalDrag || verticalDrag.pointerId !== event.pointerId) return;

    const deltaPixels = event.clientY - verticalDrag.startClientY;
    const track = (event.currentTarget as HTMLElement).parentElement;
    const trackHeight = track?.getBoundingClientRect().height ?? 0;
    const availableTrackHeight = Math.max(
      1,
      trackHeight * (1 - verticalThumbPercent / 100)
    );
    const deltaPitches = (deltaPixels / availableTrackHeight) * verticalMaxScroll;

    onPitchScrollChange(
      clampNumber(verticalDrag.startScrollY + deltaPitches, 0, verticalMaxScroll)
    );
  }

  function endVerticalScroll(event: PointerEvent) {
    if (!verticalDrag || verticalDrag.pointerId !== event.pointerId) return;

    verticalDrag = undefined;
  }

  function jumpVerticalScroll(event: PointerEvent) {
    if (verticalMaxScroll <= 0) return;
    if ((event.target as HTMLElement).classList.contains('pattern-y-scroll-thumb')) {
      return;
    }

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const localY = event.clientY - bounds.top;
    const centeredRatio =
      (localY - (verticalThumbPercent / 100) * bounds.height / 2) /
      Math.max(1, bounds.height * (1 - verticalThumbPercent / 100));

    onPitchScrollChange(
      clampNumber(centeredRatio * verticalMaxScroll, 0, verticalMaxScroll)
    );
  }

  function handleVerticalKeydown(event: KeyboardEvent) {
    if (verticalMaxScroll <= 0) return;

    const smallStep = 1;
    const pageStep = Math.max(
      smallStep,
      verticalViewportHeight / renderModel.viewport.pixelsPerSemitone
    );
    let nextScrollY = renderModel.viewport.scrollY;

    if (event.key === 'ArrowUp') {
      nextScrollY -= smallStep;
    } else if (event.key === 'ArrowDown') {
      nextScrollY += smallStep;
    } else if (event.key === 'PageUp') {
      nextScrollY -= pageStep;
    } else if (event.key === 'PageDown') {
      nextScrollY += pageStep;
    } else if (event.key === 'Home') {
      nextScrollY = 0;
    } else if (event.key === 'End') {
      nextScrollY = verticalMaxScroll;
    } else {
      return;
    }

    event.preventDefault();
    onPitchScrollChange(clampNumber(nextScrollY, 0, verticalMaxScroll));
  }

  function handleZoomXInput(event: Event) {
    onViewportZoomXChange(Number((event.currentTarget as HTMLInputElement).value));
  }

  function handleZoomYInput(event: Event) {
    onViewportZoomYChange(Number((event.currentTarget as HTMLInputElement).value));
  }

  function clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;

    return Math.min(max, Math.max(min, value));
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
    <div class="piano-roll-content" style={contentStyle}>
      <div class="pattern-x-scrollbar" aria-label="Timeline navigation">
        <span aria-hidden="true"></span>
        <div
          class="pattern-x-scroll-track"
          class:disabled={horizontalMaxScroll <= 0}
          role="scrollbar"
          aria-orientation="horizontal"
          aria-controls="pattern-editor-surface"
          aria-valuemin="0"
          aria-valuemax={horizontalMaxScroll}
          aria-valuenow={renderModel.viewport.scrollX}
          tabindex="0"
          on:pointerdown={jumpHorizontalScroll}
          on:keydown={handleHorizontalKeydown}
        >
          <button
            type="button"
            class="pattern-x-scroll-thumb"
            style={`width: ${horizontalThumbPercent}%; left: ${horizontalThumbLeftPercent}%;`}
            aria-label="Scroll timeline"
            disabled={horizontalMaxScroll <= 0}
            on:pointerdown|stopPropagation={beginHorizontalScroll}
            on:pointermove={dragHorizontalScroll}
            on:pointerup={endHorizontalScroll}
            on:pointercancel={endHorizontalScroll}
          ></button>
        </div>
        <label class="pattern-x-zoom-control" title="Horizontal zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={minZoomX}
            max={maxZoomX}
            step="0.01"
            value={renderModel.viewport.zoomX}
            aria-label="Horizontal zoom"
            on:input={handleZoomXInput}
          />
        </label>
      </div>

      <PatternGrid {renderModel} layer="ruler" />

      <div
        class="piano-roll-body"
        bind:this={bodyScrollElement}
        style={viewportHeight ? `--pattern-viewport-height: ${viewportHeight};` : undefined}
      >
        <div
          class="piano-roll-y-controls"
          aria-label={renderModel.rendererId === 'sample-grid' ? 'Lane navigation' : 'Pitch navigation'}
        >
          <div
            class="pattern-y-scroll-track"
            class:disabled={verticalMaxScroll <= 0}
            role="scrollbar"
            aria-orientation="vertical"
            aria-controls="pattern-editor-surface"
            aria-valuemin="0"
            aria-valuemax={verticalMaxScroll}
            aria-valuenow={renderModel.viewport.scrollY}
            tabindex="0"
            on:pointerdown={jumpVerticalScroll}
            on:keydown={handleVerticalKeydown}
            on:wheel|stopPropagation
          >
            <button
              type="button"
              class="pattern-y-scroll-thumb"
              style={`height: ${verticalThumbPercent}%; top: ${verticalThumbTopPercent}%;`}
              aria-label={renderModel.rendererId === 'sample-grid' ? 'Scroll lanes' : 'Scroll pitches'}
              disabled={verticalMaxScroll <= 0}
              on:pointerdown|stopPropagation={beginVerticalScroll}
              on:pointermove={dragVerticalScroll}
              on:pointerup={endVerticalScroll}
              on:pointercancel={endVerticalScroll}
            ></button>
          </div>

          <label class="pattern-y-zoom-control" title="Vertical zoom">
            <span>Zoom</span>
            <input
              type="range"
              min={minZoomY}
              max={maxZoomY}
              step="0.01"
              value={renderModel.viewport.zoomY}
              aria-label="Vertical zoom"
              on:input={handleZoomYInput}
            />
          </label>
        </div>

        <PatternGrid {renderModel} layer="pitch-ruler" />

        <div
          class="piano-roll"
          class:sample-grid={renderModel.rendererId === 'sample-grid'}
          class:panning={renderModel.isPanning}
          id="pattern-editor-surface"
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

  .piano-roll-frame {
    --piano-roll-y-scrollbar-width: 52px;
  }

  .pattern-x-scrollbar {
    position: sticky;
    left: 0;
    z-index: 8;
    min-width: 0;
    width: var(--pattern-scroll-viewport-width, 100%);
    max-width: var(--pattern-scroll-viewport-width, 100%);
    display: grid;
    grid-template-columns:
      calc(var(--piano-roll-y-scrollbar-width) + var(--ruler-label-width))
      minmax(0, 1fr)
      minmax(96px, 128px);
    align-items: center;
    gap: var(--spacing-sm);
    min-height: 30px;
    padding-right: var(--spacing-sm);
    background: var(--surface-2);
    border-bottom: var(--border-width) solid var(--border);
  }

  .pattern-x-scrollbar > span {
    min-height: 30px;
    border-right: var(--border-width) solid var(--border);
  }

  .pattern-x-scroll-track {
    position: relative;
    height: 30px;
    min-width: 0;
    cursor: pointer;
    touch-action: none;
  }

  .pattern-x-scroll-track::before {
    content: '';
    position: absolute;
    left: var(--spacing-sm);
    right: var(--spacing-sm);
    top: 50%;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 72%, transparent);
    transform: translateY(-50%);
  }

  .pattern-x-scroll-track.disabled {
    cursor: default;
    opacity: 0.55;
  }

  .pattern-x-scroll-thumb {
    position: absolute;
    top: 4px;
    bottom: 4px;
    min-width: 44px;
    padding: 0;
    border-radius: 999px;
    border-color: var(--border-strong);
    background: color-mix(in srgb, var(--accent) 18%, var(--surface));
    cursor: grab;
    touch-action: none;
  }

  .pattern-x-scroll-thumb:active {
    cursor: grabbing;
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .pattern-x-scroll-thumb:disabled {
    cursor: default;
    opacity: 0.52;
  }

  .pattern-x-zoom-control,
  .pattern-y-zoom-control {
    display: grid;
    gap: 2px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    user-select: none;
  }

  .pattern-x-zoom-control input,
  .pattern-y-zoom-control input {
    accent-color: var(--accent);
    touch-action: none;
  }

  .pattern-x-zoom-control {
    align-items: center;
  }

  .piano-roll-y-controls {
    display: grid;
    grid-template-columns: 22px 22px;
    gap: var(--spacing-xs);
    align-items: stretch;
    justify-content: center;
    height: var(--pattern-viewport-height, var(--editor-panel-min-height));
    min-width: var(--piano-roll-y-scrollbar-width);
    padding: var(--spacing-xs) 0;
    background: var(--bg);
  }

  .pattern-y-scroll-track {
    position: relative;
    min-height: 0;
    cursor: pointer;
    touch-action: none;
  }

  .pattern-y-scroll-track::before {
    content: '';
    position: absolute;
    top: var(--spacing-xs);
    bottom: var(--spacing-xs);
    left: 50%;
    width: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 72%, transparent);
    transform: translateX(-50%);
  }

  .pattern-y-scroll-track.disabled {
    cursor: default;
    opacity: 0.55;
  }

  .pattern-y-scroll-thumb {
    position: absolute;
    right: 2px;
    left: 2px;
    min-height: 44px;
    padding: 0;
    border-radius: 999px;
    border-color: var(--border-strong);
    background: color-mix(in srgb, var(--accent) 18%, var(--surface));
    cursor: grab;
    touch-action: none;
  }

  .pattern-y-scroll-thumb:active {
    cursor: grabbing;
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .pattern-y-scroll-thumb:disabled {
    cursor: default;
    opacity: 0.52;
  }

  .pattern-y-zoom-control {
    min-height: 0;
    align-items: center;
    grid-template-rows: auto minmax(0, 1fr);
    justify-items: center;
  }

  .pattern-y-zoom-control span {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
  }

  .pattern-y-zoom-control input {
    width: 100%;
    height: 100%;
    writing-mode: vertical-lr;
    direction: rtl;
  }
</style>
