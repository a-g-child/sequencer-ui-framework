<script lang="ts">
  export let transportPlaying = false;
  export let transportBpm = 120;
  export let transportBeat = 0;
  export let playbackBackendKind = 'web-audio';
  export let audioEngineStatus = 'idle';
  export let midiStatus = 'idle';
  export let preferencesStatus = 'not loaded';
  export let clockSource = 'Internal Clock';
  export let clockRunning = false;
  export let clockBeat = 0;
  export let clockBpm = 120;
  export let clockDrift: number | undefined = undefined;
  export let runtimeTransportState = 'stopped';
  export let runtimeTransportFailure: string | undefined = undefined;
  export let runtimeCommandPending = false;
  export let runtimeSamplePosition: number | undefined = undefined;
  export let runtimeSampleRate: number | undefined = undefined;
  export let runtimeCallbackCount: number | undefined = undefined;
  export let runtimeActivePlanId: number | null | undefined = undefined;
  export let runtimeActiveRevision: number | null | undefined = undefined;
  export let runtimePendingTransfers: number | undefined = undefined;
  export let runtimeXruns: number | undefined = undefined;
  export let runtimeQueueOverflows: number | undefined = undefined;
  export let playbackRunning = false;
  export let playbackQueuedEvents = 0;
  export let playbackBeat = 0;
  export let playbackLastEvent = 'none';
  export let playbackEventCount = 0;
  export let playbackEventsPerSecond = 0;
  export let playbackLastBatchSize = 0;
  export let voiceActive = 0;
  export let voiceReleased = 0;
  export let voiceStolen = 0;
  export let voiceTotalStarted = 0;
  export let voiceTotalReleased = 0;
  export let voiceTotalStolen = 0;
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
    <span>Playback Backend</span>
    <strong>{playbackBackendKind}</strong>
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
    <span>Runtime Transport</span>
    <strong>{runtimeTransportState}</strong>
  </div>
  <div>
    <span>Runtime Request</span>
    <strong>{runtimeCommandPending ? 'pending' : 'settled'}</strong>
  </div>
  <div>
    <span>Runtime Sample</span>
    <strong>{runtimeSamplePosition === undefined ? 'n/a' : runtimeSamplePosition}</strong>
  </div>
  <div>
    <span>Runtime Rate</span>
    <strong>{runtimeSampleRate === undefined ? 'n/a' : runtimeSampleRate}</strong>
  </div>
  <div>
    <span>Runtime Callbacks</span>
    <strong>{runtimeCallbackCount === undefined ? 'n/a' : runtimeCallbackCount}</strong>
  </div>
  <div>
    <span>Runtime Plan</span>
    <strong>{runtimeActivePlanId ?? 'none'} / {runtimeActiveRevision ?? 'none'}</strong>
  </div>
  <div>
    <span>Runtime Pending</span>
    <strong>{runtimePendingTransfers ?? 0}</strong>
  </div>
  <div>
    <span>Runtime XRuns</span>
    <strong>{runtimeXruns ?? 0}</strong>
  </div>
  <div>
    <span>Runtime Queues</span>
    <strong>{runtimeQueueOverflows ?? 0}</strong>
  </div>
  {#if runtimeTransportFailure}
    <div class="runtime-failure">
      <span>Runtime Failure</span>
      <strong>{runtimeTransportFailure}</strong>
    </div>
  {/if}
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
    <span>Voices</span>
    <strong>{voiceActive} active, {voiceReleased} released, {voiceStolen} stolen</strong>
  </div>
  <div>
    <span>Voice Totals</span>
    <strong>{voiceTotalStarted} started, {voiceTotalReleased} released, {voiceTotalStolen} stolen</strong>
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
    position: fixed;
    right: var(--spacing-control-lg);
    bottom: var(--spacing-control-lg);
    z-index: 50;
    width: min(640px, calc(100vw - var(--spacing-control-lg) * 2));
    max-height: min(68vh, 560px);
    padding: var(--spacing-sm);
    overflow: auto;
    border: var(--border-width) solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface) 78%, transparent);
    box-shadow: var(--elevation-raised);
    backdrop-filter: blur(16px);
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--spacing-xs);
  }

  .runtime-status div {
    min-width: 0;
    padding: var(--spacing-xs) var(--spacing-sm);
    border: var(--border-width) solid color-mix(in srgb, var(--border) 64%, transparent);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--surface-2) 58%, transparent);
    display: grid;
    gap: var(--spacing-2xs);
  }

  .runtime-status .runtime-failure {
    grid-column: 1 / -1;
    border-color: var(--danger, var(--accent));
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
    font-size: var(--font-size-sm);
    line-height: 1.15;
  }

  @media (max-width: 760px) {
    .runtime-status {
      right: var(--spacing-sm);
      bottom: var(--spacing-sm);
      width: calc(100vw - var(--spacing-sm) * 2);
      max-height: 58vh;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
