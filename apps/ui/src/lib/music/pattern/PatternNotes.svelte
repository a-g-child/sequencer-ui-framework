<script lang="ts" context="module">
  import type { PianoRollNoteView } from '../../editors/piano-roll/piano-roll-model';

  export type PatternNotePointerEventDetail = {
    pointerEvent: PointerEvent;
    note: PianoRollNoteView;
  };
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type {
    PatternRenderedNoteView,
    PatternRenderModel
  } from './pattern-renderer';
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

  function dispatchNotePointerEvent(
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    pointerEvent: PointerEvent,
    note: PatternRenderedNoteView
  ): void {
    dispatch(type, { pointerEvent, note: note.source });
  }
</script>

{#each renderModel.notes as note (note.id)}
  <button
    type="button"
    class="note"
    class:selected={renderModel.selectedNoteIds.includes(note.id)}
    class:hovered={renderModel.hoveredNoteId === note.id}
    class:resize-active={renderModel.activeToolId === 'resize-note'}
    aria-label={`${note.label} note at beat ${note.time}`}
    style={`left: ${beatToScreenX(note.time, renderModel.viewport)}px; width: ${durationToScreenWidth(note.duration, renderModel.viewport)}px; height: ${renderModel.noteHeight}px; top: ${pitchToScreenY(note.lanePitch, renderModel.viewport, renderModel.highestPitch) + 1}px;`}
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
        aria-label={`Resize ${note.label} note`}
        role="presentation"
      ></span>
    {/if}
  </button>
{/each}
