<script lang="ts">
  export let playing = false
  export let canStop = false
  export let bpm = 120
  export let beat = 0
  export let swingAmount = 0
  export let playbackBackendKind: 'web-audio' | 'native' = 'web-audio'
  export let nativeBackendAvailable = false
  export let onPlay: () => void
  export let onStop: () => void
  export let onBpmChange: (event: Event) => void
  export let onSwingChange: (value: number) => void
  export let onBackendChange: (value: 'web-audio' | 'native') => void = () => {}
  export let diagnosticsOpen = false
  export let onToggleDiagnostics: () => void = () => {}

  let swingDragPointerId: number | null = null
  let swingDragStartY = 0
  let swingDragStartValue = 0

  $: swingPercent = Math.round(swingAmount * 100)
  $: swingNormalized = Math.min(1, Math.max(0, swingAmount))
  $: swingAngle = -135 + swingNormalized * 270
  $: swingDialStyle = `
    --dial-angle: ${swingAngle}deg;
    --dial-progress: ${swingNormalized * 270}deg;
  `

  function beginSwingDrag(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement

    swingDragPointerId = event.pointerId
    swingDragStartY = event.clientY
    swingDragStartValue = swingAmount

    target.setPointerCapture(event.pointerId)
  }

  function dragSwing(event: PointerEvent): void {
    if (swingDragPointerId !== event.pointerId) return

    const target = event.currentTarget as HTMLElement

    if (!target.hasPointerCapture(event.pointerId)) return

    const verticalDistance = swingDragStartY - event.clientY
    const dragDistance = event.shiftKey ? 800 : 160
    const nextSwing = Math.min(
      1,
      Math.max(0, swingDragStartValue + verticalDistance / dragDistance)
    )

    setSwingAmount(nextSwing)
  }

  function endSwingDrag(event: PointerEvent): void {
    if (swingDragPointerId !== event.pointerId) return

    const target = event.currentTarget as HTMLElement

    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }

    swingDragPointerId = null
  }

  function handleSwingKeydown(event: KeyboardEvent): void {
    const increment = event.shiftKey ? 0.01 : 0.05

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      setSwingAmount(swingAmount + increment)
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setSwingAmount(swingAmount - increment)
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setSwingAmount(0)
    }

    if (event.key === 'End') {
      event.preventDefault()
      setSwingAmount(1)
    }
  }

  function handleSwingWheel(event: WheelEvent): void {
    event.preventDefault()

    const increment = event.shiftKey ? 0.01 : 0.05

    setSwingAmount(swingAmount + (event.deltaY < 0 ? increment : -increment))
  }

  function setSwingAmount(nextValue: number): void {
    const value = Math.min(1, Math.max(0, nextValue))
    const steppedValue = Math.round(value * 100) / 100

    onSwingChange(steppedValue)
  }

  function handleBackendChange(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value

    onBackendChange(value === 'native' ? 'native' : 'web-audio')
  }
</script>

<div class="transport-panel" aria-label="Runtime transport">
  <div class="transport-buttons">
    <button
      type="button"
      class="transport-icon-button play-button"
      aria-label="Play"
      title="Play"
      on:click={onPlay}
      disabled={playing}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
    </button>

    <button
      type="button"
      class="transport-icon-button stop-button"
      aria-label="Stop"
      title="Stop"
      on:click={onStop}
      disabled={!canStop}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="1" />
      </svg>
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

  <div class="swing-control">
    <span>Swing</span>

    <button
      type="button"
      class="swing-dial"
      style={swingDialStyle}
      role="slider"
      aria-label="Swing"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={swingPercent}
      aria-valuetext={`${swingPercent}%`}
      title={`Swing ${swingPercent}%`}
      on:pointerdown={beginSwingDrag}
      on:pointermove={dragSwing}
      on:pointerup={endSwingDrag}
      on:pointercancel={endSwingDrag}
      on:keydown={handleSwingKeydown}
      on:wheel={handleSwingWheel}
    >
      <span class="swing-dial-pointer"></span>
    </button>

    <strong>{swingPercent}%</strong>
  </div>

  <label class="backend-control" for="playback-backend">
    <span>Backend</span>
    <select
      id="playback-backend"
      value={playbackBackendKind}
      on:change={handleBackendChange}
    >
      <option value="web-audio">WebAudio</option>
      <option value="native" disabled={!nativeBackendAvailable}>Native</option>
    </select>
  </label>

  <button
    type="button"
    class="transport-icon-button diagnostics-toggle"
    class:active={diagnosticsOpen}
    aria-pressed={diagnosticsOpen}
    aria-label={diagnosticsOpen ? 'Hide diagnostics' : 'Show diagnostics'}
    title={diagnosticsOpen ? 'Hide diagnostics' : 'Show diagnostics'}
    on:click={onToggleDiagnostics}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16v14H4z" />
      <path d="m7 9 2.5 2.5L7 14" />
      <path d="M12 15h5" />
    </svg>
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
    gap: var(--spacing-xs);
  }

  .transport-icon-button {
    width: var(--control-height-md);
    min-width: var(--control-height-md);
    height: var(--control-height-md);
    padding: 0;
    border-radius: var(--radius-control);
    display: inline-grid;
    place-items: center;
    color: var(--muted);
  }

  .transport-icon-button svg {
    width: 17px;
    height: 17px;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .play-button {
    border-color: transparent;
    background: var(--accent-2);
    color: var(--text-primary);
  }

  .play-button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .stop-button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .transport-icon-button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .bpm-control,
  .backend-control,
  .swing-control,
  .beat-readout {
    min-height: var(--control-height-md);
    display: grid;
    align-items: center;
    gap: var(--spacing-2xs);
  }

  .bpm-control span,
  .backend-control span,
  .swing-control > span,
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

  .backend-control select {
    min-width: 104px;
    height: var(--control-height-sm);
    padding: 0 var(--spacing-xs);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-size-xs);
    font-weight: 800;
  }

  .backend-control select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .beat-readout strong {
    min-width: var(--beat-readout-width);
    font-size: var(--font-size-lg);
  }

  .swing-control {
    grid-template-columns: auto auto;
    grid-template-rows: auto auto;
    column-gap: var(--spacing-xs);
  }

  .swing-control > span {
    grid-column: 1 / -1;
  }

  .swing-control > strong {
    min-width: 34px;
    color: var(--text);
    font-size: var(--font-size-xs);
    text-align: right;
  }

  .swing-dial {
    --dial-angle: -135deg;
    --dial-progress: 0deg;

    position: relative;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: ns-resize;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .swing-dial::before,
  .swing-dial::after {
    content: '';
    position: absolute;
    inset: 1px;
    border-radius: 50%;
    mask: radial-gradient(
      farthest-side,
      transparent calc(100% - 2px),
      #000 calc(100% - 2px)
    );
    -webkit-mask: radial-gradient(
      farthest-side,
      transparent calc(100% - 2px),
      #000 calc(100% - 2px)
    );
  }

  .swing-dial::before {
    background: conic-gradient(
      from -135deg,
      color-mix(in srgb, var(--text) 20%, transparent) 0deg 270deg,
      transparent 270deg 360deg
    );
  }

  .swing-dial::after {
    background: conic-gradient(
      from -135deg,
      var(--accent) 0deg var(--dial-progress),
      transparent var(--dial-progress) 360deg
    );
  }

  .swing-dial-pointer {
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    transform: rotate(var(--dial-angle));
  }

  .swing-dial-pointer::after {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    width: 2px;
    height: 10px;
    border-radius: 999px;
    background: var(--text);
    transform: translateX(-50%);
  }

  .swing-dial:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
  }
</style>
