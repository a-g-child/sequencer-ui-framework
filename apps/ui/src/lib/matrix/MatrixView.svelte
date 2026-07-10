<script lang="ts">
  import type { Track, TrackMixerState } from '@sequencer/core'
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
  export let onSetTrackMixerValue: <K extends keyof TrackMixerState>(
    trackId: string,
    key: K,
    value: TrackMixerState[K]
  ) => void
  export let clipCopyMode: 'idle' | 'select-source' | 'select-target' = 'idle'
  export let clipCopySourceId: string | undefined = undefined
  export let onToggleClipCopyMode: () => void
  export let onPasteClipToSlot: (trackId: string, slotIndex: number) => void

  type MatrixDialKey = 'volume' | 'pan'

  let matrixDialDrag:
    | {
        pointerId: number
        trackId: string
        key: MatrixDialKey
        startY: number
        startValue: number
        min: number
        max: number
      }
    | undefined

  function clipForSlot(
    matrixTrack: MatrixTrackView,
    slotIndex: number
  ): MatrixClipView | undefined {
    return matrixTrack.clips.find((clip) => clip.slotIndex === slotIndex)
  }

  function dialPercent(value: number, min: number, max: number): number {
    if (!Number.isFinite(value) || max <= min) return 0

    return Math.min(1, Math.max(0, (value - min) / (max - min)))
  }

  function dialStyle(
    value: number,
    min: number,
    max: number,
    mode: MatrixDialKey
  ): string {
    const percent = dialPercent(value, min, max)
    const dialDegrees = Number((percent * 270).toFixed(3))
    const fillStart = mode === 'pan' ? Math.min(135, dialDegrees) : 0
    const fillEnd = mode === 'pan' ? Math.max(135, dialDegrees) : dialDegrees

    return [
      `--dial-value: ${percent}`,
      `--dial-fill-start: ${fillStart}deg`,
      `--dial-fill-end: ${fillEnd}deg`
    ].join(';')
  }

  function panLabel(value: number): string {
    if (Math.abs(value) < 0.005) return 'C'

    return `${value < 0 ? 'L' : 'R'}${Math.round(Math.abs(value) * 100)}`
  }

  function beginMatrixDialDrag(
    event: PointerEvent,
    trackId: string,
    key: MatrixDialKey,
    value: number,
    min: number,
    max: number
  ): void {
    const target = event.currentTarget as HTMLElement

    matrixDialDrag = {
      pointerId: event.pointerId,
      trackId,
      key,
      startY: event.clientY,
      startValue: value,
      min,
      max
    }
    target.setPointerCapture(event.pointerId)
  }

  function dragMatrixDial(event: PointerEvent): void {
    if (!matrixDialDrag || matrixDialDrag.pointerId !== event.pointerId) return

    const target = event.currentTarget as HTMLElement

    if (!target.hasPointerCapture(event.pointerId)) return

    const range = matrixDialDrag.max - matrixDialDrag.min
    const dragDistance = event.shiftKey ? 1000 : 200
    const valueDelta = ((matrixDialDrag.startY - event.clientY) / dragDistance) *
      range

    setMatrixDialValue(
      matrixDialDrag.trackId,
      matrixDialDrag.key,
      matrixDialDrag.startValue + valueDelta,
      matrixDialDrag.min,
      matrixDialDrag.max
    )
  }

  function endMatrixDialDrag(event: PointerEvent): void {
    if (!matrixDialDrag || matrixDialDrag.pointerId !== event.pointerId) return

    const target = event.currentTarget as HTMLElement

    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }

    matrixDialDrag = undefined
  }

  function handleMatrixDialKeydown(
    event: KeyboardEvent,
    trackId: string,
    key: MatrixDialKey,
    value: number,
    min: number,
    max: number
  ): void {
    const increment = event.shiftKey ? 0.001 : 0.01

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      setMatrixDialValue(trackId, key, value + increment, min, max)
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setMatrixDialValue(trackId, key, value - increment, min, max)
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setMatrixDialValue(trackId, key, min, min, max)
    }

    if (event.key === 'End') {
      event.preventDefault()
      setMatrixDialValue(trackId, key, max, min, max)
    }
  }

  function handleMatrixDialWheel(
    event: WheelEvent,
    trackId: string,
    key: MatrixDialKey,
    value: number,
    min: number,
    max: number
  ): void {
    event.preventDefault()
    setMatrixDialValue(
      trackId,
      key,
      value + (event.deltaY < 0 ? 0.01 : -0.01),
      min,
      max
    )
  }

  function setMatrixDialValue(
    trackId: string,
    key: MatrixDialKey,
    value: number,
    min: number,
    max: number
  ): void {
    if (!Number.isFinite(value)) return

    const clampedValue = Math.min(max, Math.max(min, value))
    const steppedValue = min + Math.round((clampedValue - min) / 0.01) * 0.01
    const finalValue = Number(Math.min(max, Math.max(min, steppedValue)).toFixed(6))

    if (key === 'volume') {
      onSetTrackMixerValue(trackId, 'volume', finalValue)
      return
    }

    onSetTrackMixerValue(trackId, 'pan', finalValue)
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

    <div class="matrix-actions">
      <button
        type="button"
        class="matrix-copy-button"
        class:active={clipCopyMode !== 'idle'}
        aria-pressed={clipCopyMode !== 'idle'}
        on:click={onToggleClipCopyMode}
      >
        {clipCopyMode === 'idle' ? 'Copy' : 'Cancel'}
      </button>

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
          <div class="matrix-track-mixer" aria-label={`${matrixTrack.track.name} mixer`}>
            <div
              class="matrix-dial volume-dial"
              style={dialStyle(matrixTrack.track.mixer.volume, 0, 1, 'volume')}
              title={`Volume ${Math.round(matrixTrack.track.mixer.volume * 100)}%`}
            >
              <button
                type="button"
                class="matrix-dial-button"
                role="slider"
                aria-label={`${matrixTrack.track.name} volume`}
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={matrixTrack.track.mixer.volume}
                on:pointerdown={(event) =>
                  beginMatrixDialDrag(
                    event,
                    matrixTrack.track.id,
                    'volume',
                    matrixTrack.track.mixer.volume,
                    0,
                    1
                  )}
                on:pointermove={dragMatrixDial}
                on:pointerup={endMatrixDialDrag}
                on:pointercancel={endMatrixDialDrag}
                on:keydown={(event) =>
                  handleMatrixDialKeydown(
                    event,
                    matrixTrack.track.id,
                    'volume',
                    matrixTrack.track.mixer.volume,
                    0,
                    1
                  )}
                on:wheel={(event) =>
                  handleMatrixDialWheel(
                    event,
                    matrixTrack.track.id,
                    'volume',
                    matrixTrack.track.mixer.volume,
                    0,
                    1
                  )}
              >
                <span class="matrix-dial-face" aria-hidden="true">
                  <span></span>
                </span>
              </button>
              <small>Vol</small>
            </div>

            <div
              class="matrix-dial pan-dial"
              style={dialStyle(matrixTrack.track.mixer.pan, -1, 1, 'pan')}
              title={`Pan ${panLabel(matrixTrack.track.mixer.pan)}`}
            >
              <button
                type="button"
                class="matrix-dial-button"
                role="slider"
                aria-label={`${matrixTrack.track.name} pan`}
                aria-valuemin={-1}
                aria-valuemax={1}
                aria-valuenow={matrixTrack.track.mixer.pan}
                on:pointerdown={(event) =>
                  beginMatrixDialDrag(
                    event,
                    matrixTrack.track.id,
                    'pan',
                    matrixTrack.track.mixer.pan,
                    -1,
                    1
                  )}
                on:pointermove={dragMatrixDial}
                on:pointerup={endMatrixDialDrag}
                on:pointercancel={endMatrixDialDrag}
                on:keydown={(event) =>
                  handleMatrixDialKeydown(
                    event,
                    matrixTrack.track.id,
                    'pan',
                    matrixTrack.track.mixer.pan,
                    -1,
                    1
                  )}
                on:wheel={(event) =>
                  handleMatrixDialWheel(
                    event,
                    matrixTrack.track.id,
                    'pan',
                    matrixTrack.track.mixer.pan,
                    -1,
                    1
                  )}
              >
                <span class="matrix-dial-face" aria-hidden="true">
                  <span></span>
                </span>
              </button>
              <small>Pan</small>
            </div>

            <div class="matrix-track-switches">
              <button
                type="button"
                class:active={matrixTrack.track.mixer.mute}
                aria-pressed={matrixTrack.track.mixer.mute}
                title="Mute"
                on:click={() =>
                  onSetTrackMixerValue(
                    matrixTrack.track.id,
                    'mute',
                    !matrixTrack.track.mixer.mute
                  )}
              >
                M
              </button>
              <button
                type="button"
                class:active={matrixTrack.track.mixer.solo}
                aria-pressed={matrixTrack.track.mixer.solo}
                title="Solo"
                on:click={() =>
                  onSetTrackMixerValue(
                    matrixTrack.track.id,
                    'solo',
                    !matrixTrack.track.mixer.solo
                  )}
              >
                S
              </button>
              <button
                type="button"
                class="matrix-track-stop"
                title="Stop track"
                aria-label={`Stop ${matrixTrack.track.name}`}
                on:click={() => onTrackStop(matrixTrack.track.id)}
              >
                ■
              </button>
            </div>
          </div>
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
                class:copy-selectable={clipCopyMode === 'select-source'}
                class:copy-source={clip.id === clipCopySourceId}
                class:copy-target={clipCopyMode === 'select-target'}
                aria-pressed={clip.playbackActive || clip.pendingLaunch}
                style={`--clip-play-progress: ${clip.playbackProgress ?? 0}; --clip-queue-progress: ${clip.queuedProgress ?? 0};`}
                title={clipCopyMode === 'select-source'
                  ? 'Copy this clip'
                  : clipCopyMode === 'select-target'
                    ? 'Paste here and replace this clip'
                    : 'Click to launch, long press to edit'}
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
                class:copy-target={clipCopyMode === 'select-target'}
                title={clipCopyMode === 'select-target'
                  ? 'Paste clip here'
                  : 'Add clip'}
                on:click={() =>
                  clipCopyMode === 'select-target'
                    ? onPasteClipToSlot(matrixTrack.track.id, scene.slotIndex)
                    : onAddClipToTrack(matrixTrack.track.id, scene.slotIndex)}
              >
                <span>{clipCopyMode === 'select-target' ? 'Paste' : 'Empty'}</span>
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

  .matrix-actions {
    display: flex;
    align-items: center;
    justify-content: end;
    gap: var(--spacing-sm);
    min-width: 0;
  }

  .matrix-copy-button {
    min-height: 26px;
    padding: 0 var(--spacing-sm);
    font-size: var(--font-size-xs);
    font-weight: 800;
  }

  .matrix-copy-button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .matrix-grid {
    min-width: 0;
    overflow-x: auto;
    display: grid;
    grid-template-columns: 84px;
    grid-auto-columns: 84px;
    grid-auto-flow: column;
    gap: var(--spacing-xs);
    padding-bottom: var(--spacing-xs);
  }

  .matrix-track {
    min-width: 0;
    width: 84px;
    min-height: calc(
      86px +
      (var(--matrix-scene-count) * 38px) +
      ((var(--matrix-scene-count) - 1) * 4px) +
      (2 * var(--spacing-xs))
    );
    border-left: var(--border-width) solid var(--border);
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--surface-2);
  }

  .matrix-scenes {
    min-width: 0;
    width: 84px;
    min-height: calc(
      86px +
      (var(--matrix-scene-count) * 38px) +
      ((var(--matrix-scene-count) - 1) * 4px) +
      (2 * var(--spacing-xs))
    );
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
    min-height: 116px;
    padding: var(--spacing-xs);
    border: 0;
    border-bottom: var(--border-width) solid var(--border);
    border-radius: 0;
    display: grid;
    gap: var(--spacing-2xs);
    text-align: left;
  }

  .matrix-track-header {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
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

  .matrix-track-mixer {
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(2, 30px);
    justify-content: start;
    align-items: end;
    gap: var(--spacing-2xs) var(--spacing-xs);
  }

  .matrix-dial {
    position: relative;
    min-width: 0;
    display: grid;
    justify-items: center;
    gap: 2px;
    color: var(--muted);
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .matrix-dial-button {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: ns-resize;
    touch-action: none;
  }

  .matrix-dial-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .matrix-dial-face {
    position: relative;
    display: block;
    width: 24px;
    height: 24px;
    margin: 3px;
    border: var(--border-width) solid var(--border-strong);
    border-radius: 50%;
    background:
      radial-gradient(circle at center, var(--surface-2) 0 44%, transparent 46%),
      conic-gradient(
        from -135deg,
        transparent 0deg var(--dial-fill-start),
        var(--accent) var(--dial-fill-start) var(--dial-fill-end),
        transparent var(--dial-fill-end) 270deg,
        transparent 270deg 360deg
      ),
      conic-gradient(
        from -135deg,
        color-mix(in srgb, var(--border) 76%, transparent) 0deg 270deg,
        transparent 270deg 360deg
      );
  }

  .matrix-dial-face span {
    position: absolute;
    z-index: 2;
    top: 3px;
    left: 50%;
    width: 2px;
    height: 7px;
    border-radius: 2px;
    background: var(--accent);
    transform-origin: 50% 9px;
    transform:
      translateX(-50%)
      rotate(calc((var(--dial-value) * 270deg) - 135deg));
  }

  .matrix-dial-face::after {
    content: '';
    position: absolute;
    z-index: 1;
    top: 3px;
    left: 50%;
    width: 1px;
    height: 5px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--text) 68%, transparent);
    transform: translateX(-50%) rotate(var(--dial-origin, -135deg));
    transform-origin: 50% 9px;
  }

  .volume-dial {
    --dial-origin: -135deg;
  }

  .pan-dial {
    --dial-origin: 0deg;
  }

  .matrix-track-switches {
    grid-column: 1 / -1;
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 3px;
  }

  .matrix-scene-header button {
    min-height: 16px;
    padding: 0 var(--spacing-2xs);
    font-size: 7px;
  }

  .matrix-scene-header button:hover,
  .matrix-scene-stop:hover {
    border-color: var(--accent);
  }

  .matrix-track-switches button {
    min-width: 0;
    min-height: 24px;
    padding: 0;
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: 8px;
    font-weight: 900;
    line-height: 1;
  }

  .matrix-track-switches button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .matrix-track-switches button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .matrix-track-stop {
    font-size: 9px;
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

  .matrix-clip-stack,
  .matrix-scene-stack {
    align-content: start;
    display: grid;
    grid-auto-rows: 38px;
    gap: 4px;
    padding: var(--spacing-xs);
  }

  .matrix-scene-row {
    height: 38px;
    min-height: 38px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 18px;
    gap: 2px;
  }

  .matrix-clip {
    width: 100%;
    height: 38px;
    min-height: 38px;
    padding: var(--spacing-xs);
    border-radius: var(--radius-control);
  }

  .matrix-add-clip {
    width: 100%;
    height: 38px;
    min-height: 38px;
    padding: 0;
    border-radius: var(--radius-control);
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
    width: 100%;
    height: 38px;
    min-height: 38px;
    padding: 0;
    border-radius: var(--radius-control);
    display: grid;
    place-items: center;
  }

  .matrix-scene-stop {
    width: 18px;
    height: 38px;
    min-height: 38px;
    padding: 0;
    border-radius: var(--radius-control);
    overflow: hidden;
    color: transparent;
    font-size: 0;
  }

  .matrix-scene-stop::before {
    content: '■';
    color: var(--muted);
    font-size: 7px;
    line-height: 1;
  }

  .matrix-scene-stop:hover::before {
    color: var(--accent);
  }

  .matrix-scene-stop:disabled::before {
    opacity: 0.35;
  }

  .matrix-scene-launch span,
  .matrix-scene-launch small {
    display: none;
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
    display: none;
  }

  .matrix-clip.active {
    border-color: var(--accent);
  }

  .matrix-clip.copy-selectable,
  .matrix-clip.copy-target {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent);
  }

  .matrix-clip.copy-source {
    border-color: var(--note-fill);
    background: color-mix(in srgb, var(--note-fill) 14%, var(--surface-2));
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

  @media (max-width: 760px) {
    .matrix-toolbar,
    .matrix-actions {
      align-items: stretch;
      flex-direction: column;
    }

    .matrix-actions {
      justify-content: stretch;
    }
  }
</style>
