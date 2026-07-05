<script lang="ts">
  export let transportPlaying = false;
  export let transportBpm = 120;
  export let transportBeat = 0;
  export let audioEngineStatus = 'idle';
  export let midiStatus = 'idle';
  export let preferencesStatus = 'not loaded';
  export let clockSource = 'Internal Clock';
  export let clockRunning = false;
  export let clockBeat = 0;
  export let clockBpm = 120;
  export let clockDrift: number | undefined = undefined;
  export let playbackRunning = false;
  export let playbackQueuedEvents = 0;
  export let playbackBeat = 0;
  export let playbackLastEvent = 'none';
  export let playbackEventCount = 0;
  export let playbackEventsPerSecond = 0;
  export let playbackLastBatchSize = 0;
  export let schedulerJitterMs = 0;
  export let schedulerLatencyMs = 0;
  export let maxLookaheadDepthMs = 0;
  export let largestEventBatch = 0;
  export let lateEventCount = 0;
  export let missedEventCount = 0;
  export let playbackModelRebuildMs = 0;
  export let renderModelRebuildMs = 0;
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
  <div>
    <span>Clock Source</span>
    <strong>{clockSource}</strong>
  </div>
  <div>
    <span>Clock</span>
    <strong>{clockRunning ? 'running' : 'stopped'}</strong>
  </div>
  <div>
    <span>Clock Beat</span>
    <strong>{clockBeat.toFixed(2)}</strong>
  </div>
  <div>
    <span>Clock BPM</span>
    <strong>{clockBpm}</strong>
  </div>
  <div>
    <span>Clock Drift</span>
    <strong>{clockDrift === undefined ? 'n/a' : clockDrift.toFixed(2)}</strong>
  </div>
  <div>
    <span>Scheduler</span>
    <strong>{playbackRunning ? 'running' : 'stopped'}</strong>
  </div>
  <div>
    <span>Queued</span>
    <strong>{playbackQueuedEvents}</strong>
  </div>
  <div>
    <span>Scheduler Beat</span>
    <strong>{playbackBeat.toFixed(2)}</strong>
  </div>
  <div>
    <span>Last Event</span>
    <strong>{playbackLastEvent}</strong>
  </div>
  <div>
    <span>Events</span>
    <strong>{playbackEventCount}</strong>
  </div>
  <div>
    <span>Events/Sec</span>
    <strong>{playbackEventsPerSecond.toFixed(1)}</strong>
  </div>
  <div>
    <span>Last Batch</span>
    <strong>{playbackLastBatchSize}</strong>
  </div>
  <div>
    <span>Largest Batch</span>
    <strong>{largestEventBatch}</strong>
  </div>
  <div>
    <span>Latency</span>
    <strong>{schedulerLatencyMs.toFixed(2)}ms</strong>
  </div>
  <div>
    <span>Jitter</span>
    <strong>{schedulerJitterMs.toFixed(2)}ms</strong>
  </div>
  <div>
    <span>Lookahead</span>
    <strong>{maxLookaheadDepthMs.toFixed(1)}ms</strong>
  </div>
  <div>
    <span>Late</span>
    <strong>{lateEventCount}</strong>
  </div>
  <div>
    <span>Missed</span>
    <strong>{missedEventCount}</strong>
  </div>
  <div>
    <span>Playback Build</span>
    <strong>{playbackModelRebuildMs.toFixed(2)}ms</strong>
  </div>
  <div>
    <span>Render Build</span>
    <strong>{renderModelRebuildMs.toFixed(2)}ms</strong>
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
    grid-template-columns: repeat(5, minmax(0, 1fr));
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
