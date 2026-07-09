<script lang="ts">
  import type { Track, TrackMixerState } from '@sequencer/core'

  export let track: Track | undefined = undefined
  export let disabled = false
  export let onChange: <K extends keyof TrackMixerState>(
    key: K,
    value: TrackMixerState[K]
  ) => void

  $: mixer = track?.mixer ?? {
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false
  }

  function readNumber(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value)
  }
</script>

<section class="mixer-panel" aria-label="Track mixer">
  <label class="mixer-control mixer-fader">
    <span>Volume</span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={mixer.volume}
      disabled={disabled}
      on:input={(event) => onChange('volume', readNumber(event))}
    />
    <strong>{Math.round(mixer.volume * 100)}%</strong>
  </label>

  <label class="mixer-control">
    <span>Pan</span>
    <input
      type="range"
      min="-1"
      max="1"
      step="0.01"
      value={mixer.pan}
      disabled={disabled}
      on:input={(event) => onChange('pan', readNumber(event))}
    />
    <strong>{mixer.pan.toFixed(2)}</strong>
  </label>

  <div class="mixer-buttons" aria-label="Mixer switches">
    <button
      type="button"
      class:active={mixer.mute}
      aria-pressed={mixer.mute}
      disabled={disabled}
      on:click={() => onChange('mute', !mixer.mute)}
    >
      Mute
    </button>
    <button
      type="button"
      class:active={mixer.solo}
      aria-pressed={mixer.solo}
      disabled={disabled}
      on:click={() => onChange('solo', !mixer.solo)}
    >
      Solo
    </button>
  </div>
</section>

<style>
  .mixer-panel {
    display: grid;
    gap: var(--spacing-sm);
  }

  .mixer-control {
    min-width: 0;
    display: grid;
    grid-template-columns: 58px minmax(0, 1fr) 42px;
    align-items: center;
    gap: var(--spacing-sm);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .mixer-control strong {
    color: var(--text);
    font-size: var(--font-size-xs);
    text-align: right;
  }

  .mixer-buttons {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--spacing-sm);
  }

  .mixer-buttons button {
    min-height: var(--control-height-sm);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .mixer-buttons button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
