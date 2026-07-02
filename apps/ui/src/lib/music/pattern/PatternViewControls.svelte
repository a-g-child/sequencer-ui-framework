<script lang="ts">
  export let onAddNote: (() => void) | undefined = undefined;
  export let onZoomIn: () => void;
  export let onZoomOut: () => void;
  export let onZoomPitchIn: (() => void) | undefined = undefined;
  export let onZoomPitchOut: (() => void) | undefined = undefined;
  export let onPanLeft: () => void;
  export let onPanRight: () => void;
  export let onPitchUp: () => void;
  export let onPitchDown: () => void;
  export let onResetView: () => void;
</script>

<div class="pattern-view-controls" aria-label="Piano roll view controls">
  {#if onAddNote}
    <button type="button" title="Add C4 note" aria-label="Add C4 note" on:click={onAddNote}>
      ＋♪
    </button>
  {/if}

  <span class="control-cluster" aria-label="Horizontal zoom and pan">
    <button type="button" title="Zoom out horizontally" aria-label="Zoom out horizontally" on:click={onZoomOut}>−</button>
    <button type="button" title="Zoom in horizontally" aria-label="Zoom in horizontally" on:click={onZoomIn}>＋</button>
    <button type="button" title="Pan left" aria-label="Pan left" on:click={onPanLeft}>←</button>
    <button type="button" title="Pan right" aria-label="Pan right" on:click={onPanRight}>→</button>
  </span>

  {#if onZoomPitchOut && onZoomPitchIn}
    <span class="control-cluster" aria-label="Pitch zoom and pan">
      <button type="button" title="Zoom pitches out" aria-label="Zoom pitches out" on:click={onZoomPitchOut}>↕−</button>
      <button type="button" title="Zoom pitches in" aria-label="Zoom pitches in" on:click={onZoomPitchIn}>↕＋</button>
      <button type="button" title="Pitch up" aria-label="Pitch up" on:click={onPitchUp}>↑</button>
      <button type="button" title="Pitch down" aria-label="Pitch down" on:click={onPitchDown}>↓</button>
    </span>
  {/if}

  <button type="button" title="Reset view" aria-label="Reset view" on:click={onResetView}>◎</button>
</div>
