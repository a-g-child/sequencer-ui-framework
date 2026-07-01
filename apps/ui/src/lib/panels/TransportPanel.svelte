<script lang="ts">
  export let playing = false;
  export let bpm = 120;
  export let beat = 0;
  export let onPlay: () => void;
  export let onStop: () => void;
  export let onBpmChange: (event: Event) => void;
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
  .beat-readout {
    min-height: var(--control-height-md);
    display: grid;
    align-items: center;
    gap: var(--spacing-2xs);
  }

  .bpm-control span,
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

  .beat-readout strong {
    min-width: var(--beat-readout-width);
    font-size: var(--font-size-lg);
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
