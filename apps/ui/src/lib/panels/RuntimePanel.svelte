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
  export let runtimeOwnerGenerationsSet: number | undefined = undefined;
  export let runtimeBeatEventsInserted: number | undefined = undefined;
  export let runtimeBeatEventMinSample: number | null | undefined = undefined;
  export let runtimeBeatEventMaxSample: number | null | undefined = undefined;
  export let runtimeSampleEventsInserted: number | undefined = undefined;
  export let runtimeNoteOnsDispatched: number | undefined = undefined;
  export let runtimeNoteOffsDispatched: number | undefined = undefined;
  export let runtimeEventsDiscardedOwner: number | undefined = undefined;
  export let runtimeEventsDiscardedFutureOwner: number | undefined = undefined;
  export let runtimeEventsDroppedNotPlaying: number | undefined = undefined;
  export let runtimeEventsDroppedCapacity: number | undefined = undefined;
  export let runtimeLoopReschedules: number | undefined = undefined;
  export let runtimeLoopRescheduleSkippedDisabled: number | undefined = undefined;
  export let runtimeLoopRescheduleSkippedOutside: number | undefined = undefined;
  export let runtimeEventsCleared: number | undefined = undefined;
  export let runtimeTransportLoopEnabled: boolean | undefined = undefined;
  export let runtimeTransportLoopStartSample: number | undefined = undefined;
  export let runtimeTransportLoopEndSample: number | undefined = undefined;
  export let runtimeEventGraphEventsReceived: number | undefined = undefined;
  export let runtimeEventGraphRouteDispatches: number | undefined = undefined;
  export let runtimeEventGraphEventsEmitted: number | undefined = undefined;
  export let runtimeEventGraphEventsDroppedCapacity: number | undefined = undefined;
  export let runtimeEventGraphEventsDroppedDepth: number | undefined = undefined;
  export let runtimeEventGraphEventsDroppedBudget: number | undefined = undefined;
  export let nativeRuntimeAction = 'idle';
  export let nativeRuntimeCommands = '';
  export let nativeRuntimeError: string | undefined = undefined;
  export let nativeAudioDriver = 'n/a';
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

  function formatSampleRange(
    start: number | null | undefined,
    end: number | null | undefined
  ): string {
    return start === undefined || start === null || end === undefined || end === null
      ? 'n/a'
      : `${start}-${end}`;
  }
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
    <span>Native Driver</span>
    <strong>{playbackBackendKind === 'native' ? nativeAudioDriver : 'n/a'}</strong>
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
  <div>
    <span>Runtime Owners</span>
    <strong>{runtimeOwnerGenerationsSet ?? 0}</strong>
  </div>
  <div>
    <span>Runtime Inserts</span>
    <strong>{runtimeBeatEventsInserted ?? 0} beat, {runtimeSampleEventsInserted ?? 0} sample</strong>
  </div>
  <div>
    <span>Runtime Beat Range</span>
    <strong>{formatSampleRange(runtimeBeatEventMinSample, runtimeBeatEventMaxSample)}</strong>
  </div>
  <div>
    <span>Runtime Notes</span>
    <strong>{runtimeNoteOnsDispatched ?? 0} on, {runtimeNoteOffsDispatched ?? 0} off</strong>
  </div>
  <div>
    <span>Runtime Drops</span>
    <strong>{runtimeEventsDiscardedOwner ?? 0} owner, {runtimeEventsDiscardedFutureOwner ?? 0} future</strong>
  </div>
  <div>
    <span>Runtime Rejects</span>
    <strong>{runtimeEventsDroppedCapacity ?? 0} full, {runtimeEventsDroppedNotPlaying ?? 0} stopped</strong>
  </div>
  <div>
    <span>Runtime Loops</span>
    <strong>{runtimeLoopReschedules ?? 0} loops, {runtimeEventsCleared ?? 0} cleared</strong>
  </div>
  <div>
    <span>Runtime Loop Skips</span>
    <strong>{runtimeLoopRescheduleSkippedDisabled ?? 0} off, {runtimeLoopRescheduleSkippedOutside ?? 0} outside</strong>
  </div>
  <div>
    <span>Runtime Loop Window</span>
    <strong>{runtimeTransportLoopEnabled ? 'on' : 'off'} {runtimeTransportLoopStartSample ?? 0}-{runtimeTransportLoopEndSample ?? 0}</strong>
  </div>
  <div>
    <span>Runtime Event Graph</span>
    <strong>{runtimeEventGraphEventsReceived ?? 0} in, {runtimeEventGraphRouteDispatches ?? 0} routes, {runtimeEventGraphEventsEmitted ?? 0} out</strong>
  </div>
  <div>
    <span>Runtime Event Drops</span>
    <strong>{runtimeEventGraphEventsDroppedCapacity ?? 0} full, {runtimeEventGraphEventsDroppedDepth ?? 0} depth, {runtimeEventGraphEventsDroppedBudget ?? 0} budget</strong>
  </div>
  <div>
    <span>Native Action</span>
    <strong>{nativeRuntimeAction}</strong>
  </div>
  <div>
    <span>Native Commands</span>
    <strong>{nativeRuntimeCommands || 'none'}</strong>
  </div>
  {#if nativeRuntimeError}
    <div class="runtime-failure">
      <span>Native Error</span>
      <strong>{nativeRuntimeError}</strong>
    </div>
  {/if}
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
