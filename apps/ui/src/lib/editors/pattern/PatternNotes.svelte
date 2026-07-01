<script lang="ts" context="module">
  import type { PianoRollNoteView } from '../piano-roll/piano-roll-model';

  export type PatternNotePointerEventDetail = {
    pointerEvent: PointerEvent;
    note: PianoRollNoteView;
  };
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { PatternRenderModel } from './pattern-renderer';
  import {
    beatToScreenX,
    durationToScreenWidth,
    pitchToScreenY
  } from './pattern-viewport';

  export let renderModel: PatternRenderModel;

  const dispatch = createEventDispatcher<{
    pointerdown: PatternNotePointerEventDetail;
    pointermove: PatternNotePointerEventDetail;
    pointerup: PatternNotePointerEventDetail;
  }>();

  function noteName(pitch: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(pitch / 12) - 1;

    return `${names[pitch % 12]}${octave}`;
  }

  function dispatchNotePointerEvent(
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    pointerEvent: PointerEvent,
    note: PianoRollNoteView
  ): void {
    dispatch(type, { pointerEvent, note });
  }
</script>

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
      dispatchNotePointerEvent('pointerdown', event, note)}
    on:pointermove|stopPropagation={(event) =>
      dispatchNotePointerEvent('pointermove', event, note)}
    on:pointerup|stopPropagation={(event) =>
      dispatchNotePointerEvent('pointerup', event, note)}
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
