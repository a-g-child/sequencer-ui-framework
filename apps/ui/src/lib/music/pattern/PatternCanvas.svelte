<script lang="ts">
  import type { PatternRenderModel } from './pattern-renderer';
  import PatternGrid from './PatternGrid.svelte';
  import PatternNotes, {
    type PatternNotePointerEventDetail
  } from './PatternNotes.svelte';
  import type { RenderInteractionItem } from '../../framework/editor';
  import PatternOverlays from './PatternOverlays.svelte';
  import PatternVelocityLane from './PatternVelocityLane.svelte';
  import {
    patternLengthToScreenWidth,
    pitchRangeToScreenHeight,
    pitchToScreenY
  } from './pattern-viewport';
  import type { PianoRollNoteView } from '../../editors/piano-roll/piano-roll-model';

  export let renderModel: PatternRenderModel;
  export let height: string | number | undefined = undefined;
  export let width: string | number | undefined = undefined;
  export let onViewportWidthChange: (width: number) => void;
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

  const middleCPitch = 60;

  let scrollElement: HTMLDivElement | undefined;
  $: scrollStyle = buildScrollStyle(width, height);

  export function centerOnMiddleC() {
    if (!scrollElement) return;

    const middleCOffset =
      pitchToScreenY(middleCPitch, renderModel.viewport, 127) -
      scrollElement.clientHeight / 2;

    scrollElement.scrollTop = Math.max(0, middleCOffset);
  }

  function centerOnMount(node: HTMLDivElement) {
    scrollElement = node;
    centerOnMiddleC();
    measureViewportWidth();

    const observer = new ResizeObserver(measureViewportWidth);

    observer.observe(node);

    return {
      destroy() {
        observer.disconnect();
      }
    };
  }

  function toCssSize(value: string | number | undefined): string | undefined {
    if (value === undefined) return undefined;

    return typeof value === 'number' ? `${value}px` : value;
  }

  function buildScrollStyle(
    widthValue: string | number | undefined,
    heightValue: string | number | undefined
  ): string | undefined {
    const nextWidth = toCssSize(widthValue);
    const nextHeight = toCssSize(heightValue);
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

  function measureViewportWidth() {
    if (!scrollElement) return;

    const noteSurface = scrollElement.querySelector('.piano-roll');
    const scrollBounds = scrollElement.getBoundingClientRect();
    const noteBounds = noteSurface?.getBoundingClientRect();
    const noteOffset = noteBounds ? noteBounds.left - scrollBounds.left : 0;

    onViewportWidthChange(Math.max(0, scrollElement.clientWidth - noteOffset));
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
  class:drum-rack-frame={renderModel.rendererId === 'drum-rack'}
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

      <div class="piano-roll-body">
        <PatternGrid {renderModel} layer="pitch-ruler" />

        <div
          class="piano-roll"
          class:drum-rack={renderModel.rendererId === 'drum-rack'}
          class:panning={renderModel.isPanning}
          role="application"
          aria-label={renderModel.rendererId === 'drum-rack' ? 'Drum rack notes' : 'Piano roll notes'}
          style={`width: ${patternLengthToScreenWidth(renderModel.visibleLength, renderModel.viewport)}px; height: ${pitchRangeToScreenHeight(renderModel.pitchCount, renderModel.viewport)}px;`}
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
        </div>
      </div>

      <PatternVelocityLane {renderModel} {onVelocityCommit} />
    </div>
  </div>
</div>
