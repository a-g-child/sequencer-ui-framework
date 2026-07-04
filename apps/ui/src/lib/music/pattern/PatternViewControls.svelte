<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    scaleDefinitions,
    scaleRoots,
    type PatternScaleMode,
    type PatternScaleState
  } from './pattern-scale';
  import type { ClipLoopRegion } from '../../app-controller';

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
  export let showAutomationLane = false;
  export let onToggleAutomationLane: (() => void) | undefined = undefined;
  export let loopClip = true;
  export let loopRegion: ClipLoopRegion | undefined = undefined;
  export let onToggleLoopClip: (() => void) | undefined = undefined;
  export let onClipBoundsChange: ((clipStart: number, clipLength: number) => void) | undefined = undefined;
  export let onLoopRegionChange: ((loopStart: number, loopLength: number) => void) | undefined = undefined;
  export let onQuantizeSelected: (() => void) | undefined = undefined;
  export let onHumanizeSelected: (() => void) | undefined = undefined;
  export let scale: PatternScaleState | undefined = undefined;
  export let onScaleRootChange: ((root: number) => void) | undefined = undefined;
  export let onScaleIdChange: ((scaleId: string) => void) | undefined = undefined;
  export let onScaleModeChange: ((mode: PatternScaleMode) => void) | undefined = undefined;

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

  {#if onToggleAutomationLane}
    <button
      type="button"
      class:highlighted={showAutomationLane || highlightedControl === 'automation-lane'}
      title={showAutomationLane ? 'Hide automation lane' : 'Show automation lane'}
      aria-label={showAutomationLane ? 'Hide automation lane' : 'Show automation lane'}
      aria-pressed={showAutomationLane}
      on:click={() => runViewAction('automation-lane', onToggleAutomationLane)}
    >⌁</button>
  {/if}

  {#if onToggleLoopClip}
    <span class="loop-controls" aria-label="Clip loop controls">
      <button
        type="button"
        class:highlighted={loopClip || highlightedControl === 'loop-clip'}
        title={loopClip ? 'Disable clip loop' : 'Enable clip loop'}
        aria-label={loopClip ? 'Disable clip loop' : 'Enable clip loop'}
        aria-pressed={loopClip}
        on:click={() => runViewAction('loop-clip', onToggleLoopClip)}
      >↻</button>

      {#if loopRegion && onClipBoundsChange}
        <input
          type="number"
          min="0"
          step="0.25"
          value={loopRegion.clipStart}
          title="Clip start"
          aria-label="Clip start"
          on:change={(event) =>
            onClipBoundsChange(
              Number((event.currentTarget as HTMLInputElement).value),
              loopRegion?.clipLength ?? 0.25
            )}
        />
        <input
          type="number"
          min="0.25"
          step="0.25"
          value={loopRegion.clipLength}
          title="Clip length"
          aria-label="Clip length"
          on:change={(event) =>
            onClipBoundsChange(
              loopRegion?.clipStart ?? 0,
              Number((event.currentTarget as HTMLInputElement).value)
            )}
        />
      {/if}

      {#if loopRegion && onLoopRegionChange}
        <input
          type="number"
          min="0"
          max={Math.max(0, loopRegion.clipLength - 0.25)}
          step="0.25"
          value={loopRegion.loopStart}
          title="Loop start"
          aria-label="Loop start"
          disabled={!loopClip}
          on:change={(event) =>
            onLoopRegionChange(
              Number((event.currentTarget as HTMLInputElement).value),
              loopRegion?.loopLength ?? 0.25
            )}
        />
        <input
          type="number"
          min="0.25"
          max={Math.max(0.25, loopRegion.clipLength - loopRegion.loopStart)}
          step="0.25"
          value={loopRegion.loopLength}
          title="Loop length"
          aria-label="Loop length"
          disabled={!loopClip}
          on:change={(event) =>
            onLoopRegionChange(
              loopRegion?.loopStart ?? 0,
              Number((event.currentTarget as HTMLInputElement).value)
            )}
        />
      {/if}
    </span>
  {/if}

  {#if onHumanizeSelected}
    <button
      type="button"
      class:highlighted={highlightedControl === 'humanize-selected'}
      title="Humanise selected notes"
      aria-label="Humanise selected notes"
      on:click={() => runViewAction('humanize-selected', onHumanizeSelected)}
    >≈</button>
  {/if}

  {#if onQuantizeSelected}
    <button
      type="button"
      class:highlighted={highlightedControl === 'quantize-selected'}
      title="Quantise selected notes"
      aria-label="Quantise selected notes"
      on:click={() => runViewAction('quantize-selected', onQuantizeSelected)}
    >Q</button>
  {/if}

  {#if scale && onScaleRootChange && onScaleIdChange && onScaleModeChange}
    <span class="scale-controls" aria-label="Scale fold controls">
      <select
        aria-label="Scale root"
        value={scale.root}
        on:change={(event) =>
          onScaleRootChange(Number((event.currentTarget as HTMLSelectElement).value))}
      >
        {#each scaleRoots as root}
          <option value={root.value}>{root.name}</option>
        {/each}
      </select>

      <select
        aria-label="Scale"
        value={scale.scaleId}
        on:change={(event) =>
          onScaleIdChange((event.currentTarget as HTMLSelectElement).value)}
      >
        {#each scaleDefinitions as definition}
          <option value={definition.id}>{definition.name}</option>
        {/each}
      </select>

      <span class="control-cluster" aria-label="Scale display mode">
        <button
          type="button"
          class:highlighted={scale.mode === 'off'}
          title="Disable scale guide"
          aria-label="Disable scale guide"
          aria-pressed={scale.mode === 'off'}
          on:click={() => runViewAction('scale-off', () => onScaleModeChange('off'))}
        >All</button>
        <button
          type="button"
          class:highlighted={scale.mode === 'highlight'}
          title="Highlight scale lanes"
          aria-label="Highlight scale lanes"
          aria-pressed={scale.mode === 'highlight'}
          on:click={() => runViewAction('scale-highlight', () => onScaleModeChange('highlight'))}
        >HL</button>
        <button
          type="button"
          class:highlighted={scale.mode === 'fold'}
          title="Fold to scale lanes"
          aria-label="Fold to scale lanes"
          aria-pressed={scale.mode === 'fold'}
          on:click={() => runViewAction('scale-fold', () => onScaleModeChange('fold'))}
        >Fold</button>
      </span>
    </span>
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

  .loop-controls {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .scale-controls {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    flex-wrap: wrap;
  }

  .scale-controls select {
    width: auto;
    min-width: 76px;
    min-height: var(--control-height-md);
    padding: 0 var(--spacing-sm);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-weight: 700;
  }

  .loop-controls input {
    width: 64px;
    min-height: var(--control-height-md);
    padding: 0 var(--spacing-xs);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-weight: 700;
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
