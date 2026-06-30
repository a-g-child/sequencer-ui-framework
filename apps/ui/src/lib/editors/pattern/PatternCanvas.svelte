<script lang="ts">
  import type { PianoRollNoteView } from '../piano-roll/piano-roll-model';
  import type { PatternRenderModel } from './pattern-renderer';
  import PatternGrid from './PatternGrid.svelte';
  import PatternOverlays from './PatternOverlays.svelte';
  import {
    beatToScreenX,
    durationToScreenWidth,
    patternLengthToScreenWidth,
    pitchRangeToScreenHeight,
    pitchToScreenY
  } from './pattern-viewport';

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

  function noteName(pitch: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(pitch / 12) - 1;

    return `${names[pitch % 12]}${octave}`;
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

          <PatternOverlays {renderModel} />

          {#each renderModel.notes as note (note.id)}
            <button
              type="button"
              class="note"
              class:selected={renderModel.selectedNoteIds.includes(note.id)}
              class:hovered={renderModel.hoveredNoteId === note.id}
              class:resize-active={renderModel.activeToolId === 'resize-note'}
              aria-label={`${noteName(note.pitch)} note at beat ${note.time}`}
              style={`left: ${beatToScreenX(note.time, renderModel.viewport)}px; width: ${durationToScreenWidth(note.duration, renderModel.viewport)}px; height: ${renderModel.noteHeight}px; top: ${pitchToScreenY(note.pitch, renderModel.viewport, renderModel.highestPitch) + 1}px;`}
              on:pointerdown|stopPropagation={(event) =>
                onNotePointerDown(event, note)}
              on:pointermove|stopPropagation={(event) =>
                onNotePointerMove(event, note)}
              on:pointerup|stopPropagation={(event) =>
                onNotePointerUp(event, note)}
              on:auxclick|preventDefault
            >
              {#if renderModel.activeToolId === 'resize-note'}
                <span
                  class="note-resize-handle"
                  aria-label={`Resize ${noteName(note.pitch)} note`}
                  role="presentation"
                ></span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
