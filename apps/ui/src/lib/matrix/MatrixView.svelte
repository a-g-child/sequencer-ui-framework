<script lang="ts">
  import type { Track } from '@sequencer/core'
  import type { ClipLaunchQuantize } from '@sequencer/playback'
  import type {
    MatrixClipView,
    MatrixSceneRow,
    MatrixTrackView
  } from './matrix-view-model'

  export let matrixTracks: MatrixTrackView[] = []
  export let sceneRows: MatrixSceneRow[] = []
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
  export let onSceneLaunch: (slotIndex: number) => void
  export let onSceneStop: (slotIndex: number) => void
  export let onTrackStop: (trackId: string) => void
  export let onStopAll: () => void
  export let onAddClipToTrack: (trackId: string, slotIndex?: number) => void

  function clipForSlot(
    matrixTrack: MatrixTrackView,
    slotIndex: number
  ): MatrixClipView | undefined {
    return matrixTrack.clips.find((clip) => clip.slotIndex === slotIndex)
  }
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

  <div class="matrix-grid" style={`--matrix-scene-count: ${sceneRows.length};`}>
    <section class="matrix-scenes" aria-label="Scenes">
      <div class="matrix-scene-header">
        <span>Scenes</span>
        <button type="button" on:click={onStopAll}>Stop All</button>
      </div>

      <div class="matrix-scene-stack">
        {#each sceneRows as scene (scene.slotIndex)}
          <div
            class="matrix-scene-row"
            class:playing={scene.playing}
            class:queued={scene.queued}
            class:empty={!scene.hasClips}
          >
            <button
              type="button"
              class="matrix-scene-launch"
              disabled={!scene.hasClips}
              on:click={() => onSceneLaunch(scene.slotIndex)}
            >
              <span>{scene.label}</span>
              <small>
                {#if scene.queued}
                  cueing
                {:else if scene.playing}
                  playing
                {:else if scene.hasClips}
                  stopped
                {:else}
                  empty
                {/if}
              </small>
            </button>
            <button
              type="button"
              class="matrix-scene-stop"
              disabled={!scene.playing && !scene.queued}
              aria-label={`Stop ${scene.label}`}
              on:click={() => onSceneStop(scene.slotIndex)}
            >
              Stop
            </button>
          </div>
        {/each}
      </div>
    </section>

    {#each matrixTracks as matrixTrack (matrixTrack.track.id)}
      <section
        class="matrix-track"
        class:selected={matrixTrack.track.id === selectedTrackId}
        aria-label={`${matrixTrack.track.name} clips`}
      >
        <div
          class="matrix-track-header"
          class:selected={matrixTrack.track.id === selectedTrackId}
        >
          <button
            type="button"
            class="matrix-track-select"
            on:click={() => onSelectTrack(matrixTrack.track)}
          >
            <span>{matrixTrack.track.name}</span>
            <small>{matrixTrack.queuedLaunch}</small>
          </button>
          <button
            type="button"
            class="matrix-track-stop"
            on:click={() => onTrackStop(matrixTrack.track.id)}
          >
            Stop
          </button>
        </div>

        <div class="matrix-clip-stack">
          {#each sceneRows as scene (scene.slotIndex)}
            {@const clip = clipForSlot(matrixTrack, scene.slotIndex)}
            {#if clip}
              <button
                type="button"
                class="matrix-clip"
                class:active={clip.active}
                class:playing={clip.playbackActive}
                class:queued={clip.pendingLaunch}
                class:stopped={!clip.playbackActive && !clip.pendingLaunch}
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
                    cue {formatBeat(clip.launchAtBeat)}
                  {:else if clip.playbackActive}
                    playing
                  {:else}
                    stopped
                  {/if}
                </small>
              </button>
            {:else}
              <button
                type="button"
                class="matrix-clip matrix-empty-clip"
                on:click={() => onAddClipToTrack(matrixTrack.track.id, scene.slotIndex)}
              >
                <span>Empty</span>
                <small>slot {scene.slotIndex + 1}</small>
              </button>
            {/if}
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
    grid-template-columns: 132px;
    grid-auto-columns: 176px;
    grid-auto-flow: column;
    gap: var(--spacing-sm);
    padding-bottom: var(--spacing-xs);
  }

  .matrix-track {
    min-width: 0;
    width: 176px;
    min-height: calc(58px + (var(--matrix-scene-count) * 74px));
    border-left: var(--border-width) solid var(--border);
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--surface-2);
  }

  .matrix-scenes {
    min-width: 0;
    width: 132px;
    min-height: calc(58px + (var(--matrix-scene-count) * 74px));
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--surface-2);
    border-left: var(--border-width) solid var(--border);
  }

  .matrix-track.selected {
    border-left-color: var(--accent);
  }

  .matrix-track-header,
  .matrix-scene-header {
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

  .matrix-track-header {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .matrix-scene-header {
    align-content: center;
  }

  .matrix-track-header.selected {
    background: var(--accent-soft);
  }

  .matrix-track-select {
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    display: grid;
    gap: var(--spacing-2xs);
    text-align: left;
  }

  .matrix-track-stop,
  .matrix-scene-header button,
  .matrix-scene-stop {
    min-height: 24px;
    padding: 0 var(--spacing-xs);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .matrix-track-stop:hover,
  .matrix-scene-header button:hover,
  .matrix-scene-stop:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .matrix-scene-header span,
  .matrix-track-select span,
  .matrix-clip > span:not(.matrix-clip-queue-progress):not(.matrix-clip-playhead) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 800;
  }

  .matrix-track-select small,
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
    padding: var(--spacing-sm);
    gap: var(--spacing-xs);
  }

  .matrix-scene-stack {
    align-content: start;
    display: grid;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm);
  }

  .matrix-scene-row {
    min-height: 68px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--spacing-2xs);
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

  .matrix-scene-launch {
    min-width: 0;
    min-height: 42px;
    padding: var(--spacing-xs);
    border-radius: var(--radius-md);
    display: grid;
    align-content: center;
    gap: var(--spacing-2xs);
    text-align: left;
  }

  .matrix-scene-launch span,
  .matrix-scene-launch small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .matrix-scene-launch small {
    color: var(--muted);
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .matrix-scene-row.playing .matrix-scene-launch {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--surface-0);
    box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--surface-0) 24%, transparent);
  }

  .matrix-scene-row.playing .matrix-scene-launch small {
    color: var(--surface-0);
  }

  .matrix-scene-row.queued .matrix-scene-launch {
    border-color: var(--note-fill);
    background: color-mix(in srgb, var(--note-fill) 16%, var(--surface-2));
    color: var(--text-primary);
  }

  .matrix-scene-row.empty .matrix-scene-launch,
  .matrix-empty-clip {
    border-style: dashed;
    color: var(--muted);
    opacity: 0.72;
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
    box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--surface-0) 24%, transparent);
  }

  .matrix-clip.playing small {
    color: var(--surface-0);
  }

  .matrix-clip.queued {
    border-color: var(--note-fill);
    background: color-mix(in srgb, var(--note-fill) 16%, var(--surface-2));
  }

  .matrix-clip.stopped {
    border-color: var(--border);
    background: color-mix(in srgb, var(--surface) 88%, var(--surface-2));
  }

  .matrix-clip-queue-progress {
    position: absolute;
    inset: auto 0 0 0;
    z-index: 1;
    height: 100%;
    width: calc(var(--clip-queue-progress) * 100%);
    background: color-mix(in srgb, var(--note-fill) 28%, transparent);
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
