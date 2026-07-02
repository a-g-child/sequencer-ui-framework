<script lang="ts" context="module">
  import type { PianoRollNoteView } from '../../editors/piano-roll/piano-roll-model';

  export type PatternNotePointerEventDetail = {
    pointerEvent: PointerEvent;
    note: PianoRollNoteView;
  };
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { PatternRenderModel } from './pattern-renderer';
  import type { RenderItem } from './pattern-render-items';

  export let renderModel: PatternRenderModel;

  const dispatch = createEventDispatcher<{
    pointerdown: PatternNotePointerEventDetail;
    pointermove: PatternNotePointerEventDetail;
    pointerup: PatternNotePointerEventDetail;
  }>();

  function dispatchNotePointerEvent(
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    pointerEvent: PointerEvent,
    item: RenderItem<PianoRollNoteView>
  ): void {
    dispatch(type, { pointerEvent, note: item.source });
  }
</script>

{#each renderModel.items as item (item.id)}
  <button
    type="button"
    class="note"
    class:selected={item.selected}
    class:hovered={item.hovered}
    class:resize-active={renderModel.activeToolId === 'resize-note'}
    aria-label={`Pattern item ${item.id}`}
    style={`left: ${item.x}px; top: ${item.y}px; width: ${item.width}px; height: ${item.height}px;`}
    on:pointerdown|stopPropagation={(event) =>
      dispatchNotePointerEvent('pointerdown', event, item)}
    on:pointermove|stopPropagation={(event) =>
      dispatchNotePointerEvent('pointermove', event, item)}
    on:pointerup|stopPropagation={(event) =>
      dispatchNotePointerEvent('pointerup', event, item)}
    on:auxclick|preventDefault
  >
    {#if renderModel.activeToolId === 'resize-note'}
      <span
        class="note-resize-handle"
        aria-label={`Resize pattern item ${item.id}`}
        role="presentation"
      ></span>
    {/if}
  </button>
{/each}
