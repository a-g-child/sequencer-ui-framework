<script lang="ts">
  export let playing = false;
  export let bpm = 120;
  export let beat = 0;
  export let swingAmount = 0;
  export let onPlay: () => void;
  export let onStop: () => void;
  export let onBpmChange: (event: Event) => void;
  export let onSwingChange: (event: Event) => void;
  export let diagnosticsOpen = false;
  export let onToggleDiagnostics: () => void = () => {};
</script>

<div class="transport-panel" aria-label="Runtime transport">
  <div class="transport-buttons">
    <button type="button" on:click={onPlay} disabled={playing}>
      Play
    </button>
    <button type="button" on:click={onStop} disabled={!playing}>
      Stop
    </button>
  </div>

  <label class="bpm-control" for="runtime-bpm">
    <span>BPM</span>
    <input
      id="runtime-bpm"
      type="number"
      min="1"
      step="1"
      value={bpm}
      on:change={onBpmChange}
    />
  </label>

  <div class="beat-readout">
    <span>Beat</span>
    <strong>{beat.toFixed(2)}</strong>
  </div>

  <label class="swing-control" for="global-swing">
    <span>Swing</span>
    <input
      id="global-swing"
      type="range"
      min="0"
      max="100"
      step="1"
      value={Math.round(swingAmount * 100)}
      on:input={onSwingChange}
    />
    <strong>{Math.round(swingAmount * 100)}%</strong>
  </label>

  <button
    type="button"
    class="diagnostics-toggle"
    class:active={diagnosticsOpen}
    aria-pressed={diagnosticsOpen}
    aria-label={diagnosticsOpen ? 'Hide diagnostics' : 'Show diagnostics'}
    title={diagnosticsOpen ? 'Hide diagnostics' : 'Show diagnostics'}
    on:click={onToggleDiagnostics}
  >
    Log
  </button>
</div>

<style>
  .transport-panel {
    min-height: var(--transport-min-height);
    padding: var(--spacing-control);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    gap: var(--spacing-compact);
    background: var(--surface-2);
  }

  .transport-buttons {
    display: flex;
    gap: var(--spacing-sm);
  }

  .transport-buttons button {
    min-height: var(--control-height-md);
    padding: 0 var(--spacing-md);
    border-radius: var(--radius-control);
    font-weight: 700;
  }

  .transport-buttons button:first-child {
    border-color: transparent;
    background: var(--accent-2);
    color: var(--text-primary);
  }

  .bpm-control,
  .swing-control,
  .beat-readout {
    min-height: var(--control-height-md);
    display: grid;
    align-items: center;
    gap: var(--spacing-2xs);
  }

  .bpm-control span,
  .swing-control span,
  .beat-readout span {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    line-height: 1;
    text-transform: uppercase;
  }

  .bpm-control input {
    width: var(--bpm-control-width);
    min-height: var(--control-height-sm);
    padding: 0 var(--spacing-sm);
  }

  .swing-control {
    grid-template-columns: auto minmax(92px, 1fr) 34px;
    column-gap: var(--spacing-xs);
  }

  .swing-control span {
    grid-column: 1 / -1;
  }

  .swing-control input {
    min-width: 92px;
    accent-color: var(--accent);
  }

  .swing-control strong {
    color: var(--text);
    font-size: var(--font-size-xs);
    text-align: right;
  }

  .beat-readout strong {
    min-width: var(--beat-readout-width);
    font-size: var(--font-size-lg);
  }

  .diagnostics-toggle {
    min-height: var(--control-height-md);
    padding: 0 var(--spacing-md);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-weight: 800;
  }

  .diagnostics-toggle.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  @media (max-width: 760px) {
    .transport-panel {
      align-items: stretch;
      flex-wrap: wrap;
    }

    .transport-buttons {
      flex: 1 1 var(--mobile-transport-basis);
    }

    .transport-buttons button {
      flex: 1 1 0;
    }
  }
</style>
