<script lang="ts">
  import type { Track } from '@sequencer/core'
  import type { ClipLaunchQuantize } from '@sequencer/playback'
  import type { MatrixClipView, MatrixTrackView } from './matrix-view-model'

  export let matrixTracks: MatrixTrackView[] = []
  export let selectedTrackId = ''
  export let launchQuantize: ClipLaunchQuantize = 'bar'
  export let launchQuantizeOptions: Array<{
    id: ClipLaunchQuantize
    label: string
  }> = []
  export let launchQuantizeLabel: (quantize: ClipLaunchQuantize) => string
  export let formatBeat: (beat: number | undefined) => string
  export let onSetLaunchQuantize: (quantize: ClipLaunchQuantize) => void
  export let onSelectTrack: (track: Track) => void
  export let onClipPointerDown: (clip: MatrixClipView) => void
  export let onClipPointerEnd: () => void
  export let onClipClick: (clip: MatrixClipView) => void
  export let onAddClipToTrack: (trackId: string) => void
</script>

<section class="matrix-view" aria-label="Clip matrix">
  <div class="matrix-toolbar">
    <div>
      <h2>Matrix</h2>
      <span>
        Launch quantize: {launchQuantizeLabel(launchQuantize)}
      </span>
    </div>

    <div class="clip-launch-controls" aria-label="Clip launch quantize">
      {#each launchQuantizeOptions as option (option.id)}
        <button
          type="button"
          class:active={launchQuantize === option.id}
          on:click={() => onSetLaunchQuantize(option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="matrix-grid">
    {#each matrixTracks as matrixTrack (matrixTrack.track.id)}
      <section
        class="matrix-track"
        class:selected={matrixTrack.track.id === selectedTrackId}
        aria-label={`${matrixTrack.track.name} clips`}
      >
        <button
          type="button"
          class="matrix-track-header"
          class:selected={matrixTrack.track.id === selectedTrackId}
          on:click={() => onSelectTrack(matrixTrack.track)}
        >
          <span>{matrixTrack.track.name}</span>
          <small>{matrixTrack.queuedLaunch}</small>
        </button>

        <div class="matrix-clip-stack">
          {#each matrixTrack.clips as clip (clip.id)}
            <button
              type="button"
              class="matrix-clip"
              class:active={clip.active}
              class:playing={clip.playbackActive}
              class:queued={clip.pendingLaunch}
              aria-pressed={clip.playbackActive || clip.pendingLaunch}
              style={`--clip-play-progress: ${clip.playbackProgress ?? 0}; --clip-queue-progress: ${clip.queuedProgress ?? 0};`}
              title="Click to launch, long press to edit"
              on:pointerdown={() => onClipPointerDown(clip)}
              on:pointerup={onClipPointerEnd}
              on:pointerleave={onClipPointerEnd}
              on:pointercancel={onClipPointerEnd}
              on:click={() => onClipClick(clip)}
            >
              <span class="matrix-clip-queue-progress" aria-hidden="true"></span>
              <span class="matrix-clip-playhead" aria-hidden="true"></span>
              <span>{clip.name}</span>
              <small>
                {#if clip.pendingLaunch}
                  queued {formatBeat(clip.launchAtBeat)}
                {:else if clip.playbackActive}
                  playing
                {:else}
                  slot {clip.slotIndex + 1}
                {/if}
              </small>
            </button>
          {/each}

          <button
            type="button"
            class="matrix-add-clip"
            aria-label={`Add clip to ${matrixTrack.track.name}`}
            on:click={() => onAddClipToTrack(matrixTrack.track.id)}
          >
            +
          </button>
        </div>
      </section>
    {/each}
  </div>
</section>

<style>
  .matrix-view {
    min-width: 0;
    display: grid;
    gap: var(--spacing-lg);
  }

  .matrix-toolbar {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--spacing-lg);
  }

  .matrix-toolbar > div:first-child {
    display: grid;
    gap: var(--spacing-2xs);
  }

  .matrix-toolbar span {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .matrix-grid {
    min-width: 0;
    overflow-x: auto;
    display: grid;
    grid-auto-columns: 176px;
    grid-auto-flow: column;
    gap: var(--spacing-sm);
    padding-bottom: var(--spacing-xs);
  }

  .matrix-track {
    min-width: 0;
    width: 176px;
    min-height: 360px;
    border-left: var(--border-width) solid var(--border);
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--surface-2);
  }

  .matrix-track.selected {
    border-left-color: var(--accent);
  }

  .matrix-track-header {
    min-width: 0;
    min-height: 58px;
    padding: var(--spacing-sm);
    border: 0;
    border-bottom: var(--border-width) solid var(--border);
    border-radius: 0;
    display: grid;
    gap: var(--spacing-2xs);
    text-align: left;
  }

  .matrix-track-header.selected {
    background: var(--accent-soft);
  }

  .matrix-track-header span,
  .matrix-clip > span:not(.matrix-clip-queue-progress):not(.matrix-clip-playhead) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 800;
  }

  .matrix-track-header small,
  .matrix-clip small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: var(--font-size-xs);
  }

  .matrix-clip-stack {
    align-content: start;
    display: grid;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm);
  }

  .matrix-clip,
  .matrix-add-clip {
    width: 100%;
    min-height: 68px;
    padding: var(--spacing-sm);
    border-radius: var(--radius-md);
  }

  .matrix-clip {
    position: relative;
    overflow: hidden;
    display: grid;
    align-content: space-between;
    text-align: left;
    touch-action: manipulation;
    user-select: none;
  }

  .matrix-clip > span:not(.matrix-clip-queue-progress):not(.matrix-clip-playhead),
  .matrix-clip small {
    position: relative;
    z-index: 2;
  }

  .matrix-clip.active {
    border-color: var(--accent);
  }

  .matrix-clip.playing {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--surface-0);
  }

  .matrix-clip.playing small {
    color: var(--surface-0);
  }

  .matrix-clip.queued {
    border-color: var(--accent-strong);
    background: var(--accent-soft);
  }

  .matrix-clip-queue-progress {
    position: absolute;
    inset: auto 0 0 0;
    z-index: 1;
    height: 100%;
    width: calc(var(--clip-queue-progress) * 100%);
    background: color-mix(in srgb, var(--accent-strong) 28%, transparent);
    pointer-events: none;
    opacity: 0;
  }

  .matrix-clip.queued .matrix-clip-queue-progress {
    opacity: 1;
  }

  .matrix-clip-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--clip-play-progress) * 100%);
    z-index: 3;
    width: 2px;
    background: var(--surface-0);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 54%, transparent);
    pointer-events: none;
    opacity: 0;
    transform: translateX(-1px);
  }

  .matrix-clip.playing .matrix-clip-playhead {
    opacity: 1;
  }

  .matrix-add-clip {
    min-height: 42px;
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: var(--font-size-xl);
    font-weight: 800;
  }

  .clip-launch-controls {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--spacing-xs);
  }

  .clip-launch-controls button {
    min-width: 0;
    min-height: 26px;
    padding: 0 var(--spacing-xs);
    font-size: var(--font-size-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clip-launch-controls button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
</style>
