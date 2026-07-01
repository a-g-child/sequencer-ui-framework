<script lang="ts">
  import type { PatternRenderModel } from './pattern-renderer';
  import PatternGrid from './PatternGrid.svelte';
  import PatternNotes, {
    type PatternNotePointerEventDetail
  } from './PatternNotes.svelte';
  import PatternOverlays from './PatternOverlays.svelte';
  import {
    patternLengthToScreenWidth,
    pitchRangeToScreenHeight,
    pitchToScreenY
  } from './pattern-viewport';
  import type { PianoRollNoteView } from '../piano-roll/piano-roll-model';

  export let renderModel: PatternRenderModel;
  export let onWheel: (event: WheelEvent) => void;
  export let onPointerEnter: (event: PointerEvent) => void;
  export let onPointerDown: (event: PointerEvent) => void;
  export let onPointerMove: (event: PointerEvent) => void;
  export let onPointerUp: (event: PointerEvent) => void;
  export let onPointerLeave: (event: PointerEvent) => void;
  export let onNotePointerDown: (
    event: PointerEvent,
    note: PianoRollNoteView
  ) => void;
  export let onNotePointerMove: (
    event: PointerEvent,
    note: PianoRollNoteView
  ) => void;
  export let onNotePointerUp: (
    event: PointerEvent,
    note: PianoRollNoteView
  ) => void;

  const middleCPitch = 60;

  let scrollElement: HTMLDivElement | undefined;

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
  }

  function handleNotePointerDown(
    event: CustomEvent<PatternNotePointerEventDetail>
  ): void {
    onNotePointerDown(event.detail.pointerEvent, event.detail.note);
  }

  function handleNotePointerMove(
    event: CustomEvent<PatternNotePointerEventDetail>
  ): void {
    onNotePointerMove(event.detail.pointerEvent, event.detail.note);
  }

  function handleNotePointerUp(
    event: CustomEvent<PatternNotePointerEventDetail>
  ): void {
    onNotePointerUp(event.detail.pointerEvent, event.detail.note);
  }
</script>

<div
  class="piano-roll-frame"
>
  <div
    class="piano-roll-scroll"
    bind:this={scrollElement}
    use:centerOnMount
    on:wheel={onWheel}
  >
    <div class="piano-roll-content">
      <PatternGrid {renderModel} layer="ruler" />

      <div class="piano-roll-body">
        <PatternGrid {renderModel} layer="pitch-ruler" />

        <div
          class="piano-roll"
          class:panning={renderModel.isPanning}
          role="application"
          aria-label="Piano roll notes"
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
    </div>
  </div>
</div>
