<script lang="ts">
  export let transportPlaying = false;
  export let transportBpm = 120;
  export let transportBeat = 0;
  export let audioEngineStatus = 'idle';
  export let midiStatus = 'idle';
  export let preferencesStatus = 'not loaded';
</script>

<section class="runtime-status" aria-label="Runtime service status">
  <div>
    <span>Editor Transport</span>
    <strong>{transportPlaying ? 'playing' : 'stopped'}</strong>
  </div>
  <div>
    <span>Tempo</span>
    <strong>{transportBpm}</strong>
  </div>
  <div>
    <span>Beat</span>
    <strong>{transportBeat.toFixed(2)}</strong>
  </div>
  <div>
    <span>Audio Engine</span>
    <strong>{audioEngineStatus}</strong>
  </div>
  <div>
    <span>MIDI</span>
    <strong>{midiStatus}</strong>
  </div>
  <div>
    <span>Preferences</span>
    <strong>{preferencesStatus}</strong>
  </div>
</section>

<style>
  .runtime-status {
    min-height: var(--status-grid-min-height);
    padding: var(--spacing-compact) var(--spacing-control-lg);
    border: var(--border-width) solid var(--border);
    background: var(--surface);
    box-shadow: var(--elevation-raised);
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--spacing-compact);
  }

  .runtime-status div {
    min-width: 0;
    padding: var(--spacing-sm) var(--spacing-compact);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    display: grid;
    gap: var(--spacing-2xs);
  }

  .runtime-status span {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    line-height: 1;
    text-transform: uppercase;
  }

  .runtime-status strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--font-size-lg);
  }

  @media (max-width: 760px) {
    .runtime-status {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
