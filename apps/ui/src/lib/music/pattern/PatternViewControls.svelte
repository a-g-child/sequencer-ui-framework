<script lang="ts">
  import { onDestroy } from 'svelte';

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
  export let showVelocityLane = false;
  export let onToggleVelocityLane: (() => void) | undefined = undefined;
  export let showProbabilityLane = false;
  export let onToggleProbabilityLane: (() => void) | undefined = undefined;

  let highlightedControl = '';
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;

  function runViewAction(control: string, action: () => void) {
    action();
    highlightedControl = control;

    if (highlightTimer) {
      clearTimeout(highlightTimer);
    }

    highlightTimer = setTimeout(() => {
      highlightedControl = '';
    }, 180);
  }

  onDestroy(() => {
    if (highlightTimer) {
      clearTimeout(highlightTimer);
    }
  });
</script>

<div class="pattern-view-controls" aria-label="Pattern view controls">
  {#if onAddNote}
    <button
      type="button"
      class:highlighted={highlightedControl === 'add-note'}
      title="Add C4 note"
      aria-label="Add C4 note"
      on:click={() => runViewAction('add-note', onAddNote)}
    >
      ＋♪
    </button>
  {/if}

  {#if onToggleVelocityLane}
    <button
      type="button"
      class:highlighted={showVelocityLane || highlightedControl === 'velocity-lane'}
      title={showVelocityLane ? 'Hide velocity lane' : 'Show velocity lane'}
      aria-label={showVelocityLane ? 'Hide velocity lane' : 'Show velocity lane'}
      aria-pressed={showVelocityLane}
      on:click={() => runViewAction('velocity-lane', onToggleVelocityLane)}
    >▥</button>
  {/if}

  {#if onToggleProbabilityLane}
    <button
      type="button"
      class:highlighted={showProbabilityLane || highlightedControl === 'probability-lane'}
      title={showProbabilityLane ? 'Hide probability lane' : 'Show probability lane'}
      aria-label={showProbabilityLane ? 'Hide probability lane' : 'Show probability lane'}
      aria-pressed={showProbabilityLane}
      on:click={() => runViewAction('probability-lane', onToggleProbabilityLane)}
    >％</button>
  {/if}

  <span class="control-cluster" aria-label="Horizontal zoom and pan">
    <button
      type="button"
      class:highlighted={highlightedControl === 'zoom-out-x'}
      title="Zoom out horizontally"
      aria-label="Zoom out horizontally"
      on:click={() => runViewAction('zoom-out-x', onZoomOut)}
    >−</button>
    <button
      type="button"
      class:highlighted={highlightedControl === 'zoom-in-x'}
      title="Zoom in horizontally"
      aria-label="Zoom in horizontally"
      on:click={() => runViewAction('zoom-in-x', onZoomIn)}
    >＋</button>
    <button
      type="button"
      class:highlighted={highlightedControl === 'pan-left'}
      title="Pan left"
      aria-label="Pan left"
      on:click={() => runViewAction('pan-left', onPanLeft)}
    >←</button>
    <button
      type="button"
      class:highlighted={highlightedControl === 'pan-right'}
      title="Pan right"
      aria-label="Pan right"
      on:click={() => runViewAction('pan-right', onPanRight)}
    >→</button>
  </span>

  {#if onZoomPitchOut && onZoomPitchIn}
    <span class="control-cluster" aria-label="Pitch zoom and pan">
      <button
        type="button"
        class:highlighted={highlightedControl === 'zoom-out-y'}
        title="Zoom pitches out"
        aria-label="Zoom pitches out"
        on:click={() => runViewAction('zoom-out-y', onZoomPitchOut)}
      >↕−</button>
      <button
        type="button"
        class:highlighted={highlightedControl === 'zoom-in-y'}
        title="Zoom pitches in"
        aria-label="Zoom pitches in"
        on:click={() => runViewAction('zoom-in-y', onZoomPitchIn)}
      >↕＋</button>
      <button
        type="button"
        class:highlighted={highlightedControl === 'pitch-up'}
        title="Pitch up"
        aria-label="Pitch up"
        on:click={() => runViewAction('pitch-up', onPitchUp)}
      >↑</button>
      <button
        type="button"
        class:highlighted={highlightedControl === 'pitch-down'}
        title="Pitch down"
        aria-label="Pitch down"
        on:click={() => runViewAction('pitch-down', onPitchDown)}
      >↓</button>
    </span>
  {/if}

  <button
    type="button"
    class:highlighted={highlightedControl === 'reset-view'}
    title="Reset view"
    aria-label="Reset view"
    on:click={() => runViewAction('reset-view', onResetView)}
  >◎</button>
</div>

<style>
  .pattern-view-controls {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .control-cluster {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .pattern-view-controls button {
    min-width: var(--control-height-md);
    min-height: var(--control-height-md);
    padding: 0 var(--spacing-control);
    border-radius: var(--radius-md);
    color: var(--muted);
    background: var(--surface-2);
    font-weight: 800;
  }

  .pattern-view-controls button:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .pattern-view-controls button:active,
  .pattern-view-controls button.highlighted {
    border-color: var(--accent-strong);
    background: var(--accent-soft);
    color: var(--text);
    box-shadow: inset 0 0 0 var(--border-width) var(--accent-strong);
  }
</style>
