<script lang="ts">
  import type {
    DeviceParameterDescriptor,
    DeviceParameterValue
  } from '@sequencer/device'

  export let descriptor: DeviceParameterDescriptor
  export let value: DeviceParameterValue
  export let disabled = false
  export let automated = false
  export let onChange: (value: DeviceParameterValue) => void = () => {}

  $: numberValue = Number(value ?? descriptor.defaultValue)
  $: displayValue = Number.isFinite(numberValue) ? numberValue : 0
  $: minimum = descriptor.min ?? 0
  $: maximum = descriptor.max ?? 1
  $: step = descriptor.step ?? 0.01
  $: scale = descriptor.scale ?? 'linear'
  $: normalizedValue = normalizeValue(displayValue, minimum, maximum, scale)
  $: angle = -135 + normalizedValue * 270
  $: formattedValue = formatValue(displayValue, step)
  $: dialStyle = `--dial-angle: ${angle}deg; --dial-fill: ${normalizedValue * 100}%`

  function beginDialDrag(event: PointerEvent) {
    if (disabled) return

    const target = event.currentTarget as HTMLElement

    target.setPointerCapture(event.pointerId)
    updateFromPointer(event, target)
  }

  function dragDial(event: PointerEvent) {
    if (disabled) return

    const target = event.currentTarget as HTMLElement

    if (!target.hasPointerCapture(event.pointerId)) return

    updateFromPointer(event, target)
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled) return

    const increment = step || 0.01

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      setValue(displayValue + increment)
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setValue(displayValue - increment)
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setValue(minimum)
    }

    if (event.key === 'End') {
      event.preventDefault()
      setValue(maximum)
    }
  }

  function handleWheel(event: WheelEvent) {
    if (disabled) return

    event.preventDefault()
    setValue(displayValue + (event.deltaY < 0 ? step : -step))
  }

  function updateFromPointer(event: PointerEvent, target: HTMLElement) {
    const bounds = target.getBoundingClientRect()
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    const radians = Math.atan2(event.clientY - centerY, event.clientX - centerX)
    let degrees = radians * 180 / Math.PI + 90

    if (degrees < -180) degrees += 360
    if (degrees > 180) degrees -= 360

    const clampedAngle = Math.min(135, Math.max(-135, degrees))
    const nextValue = valueFromNormalized(
      (clampedAngle + 135) / 270,
      minimum,
      maximum,
      scale
    )

    setValue(nextValue)
  }

  function setValue(nextValue: number) {
    if (!Number.isFinite(nextValue)) return

    const clampedValue = Math.min(maximum, Math.max(minimum, nextValue))
    const steppedValue = step > 0
      ? Math.round(clampedValue / step) * step
      : clampedValue

    onChange(Number(steppedValue.toFixed(6)))
  }

  function normalizeValue(
    current: number,
    min: number,
    max: number,
    currentScale: DeviceParameterDescriptor['scale']
  ): number {
    if (max <= min) return 0

    const linearValue = Math.min(1, Math.max(0, (current - min) / (max - min)))

    if (currentScale !== 'logarithmic') return linearValue

    return Math.pow(linearValue, 1 / 3)
  }

  function valueFromNormalized(
    normalized: number,
    min: number,
    max: number,
    currentScale: DeviceParameterDescriptor['scale']
  ): number {
    const clampedValue = Math.min(1, Math.max(0, normalized))

    if (currentScale !== 'logarithmic') {
      return min + clampedValue * (max - min)
    }

    return min + Math.pow(clampedValue, 3) * (max - min)
  }

  function formatValue(current: number, currentStep: number): string {
    if (!Number.isFinite(current)) return '0'
    if (Math.abs(current) >= 1000) return Math.round(current).toString()
    if (currentStep >= 1) return Math.round(current).toString()
    if (currentStep >= 0.1) return current.toFixed(1)

    return current.toFixed(2)
  }
</script>

<label class="parameter-control" class:automated title={automated ? 'Automated' : undefined}>
  <span>
    {descriptor.name}
    {#if automated}
      <i aria-label="Automated"></i>
    {/if}
  </span>
  <div class="number-control">
    <button
      type="button"
      class="dial"
      style={dialStyle}
      role="slider"
      aria-label={descriptor.name}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={displayValue}
      disabled={disabled}
      on:pointerdown={beginDialDrag}
      on:pointermove={dragDial}
      on:keydown={handleKeydown}
      on:wheel={handleWheel}
    >
      <span class="dial-face">
        <span class="dial-pointer"></span>
      </span>
    </button>
    <strong>{formattedValue}</strong>
    {#if descriptor.unit}
      <small>{descriptor.unit}</small>
    {/if}
  </div>
</label>

<style>
  .parameter-control {
    min-width: 0;
    display: grid;
    gap: var(--spacing-2xs);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .parameter-control span {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-2xs);
  }

  .parameter-control i {
    width: 6px;
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .parameter-control.automated {
    color: var(--accent);
  }

  .number-control {
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .dial {
    position: relative;
    width: 44px;
    aspect-ratio: 1;
    padding: 0;
    border-radius: 50%;
    border: var(--border-width) solid var(--border);
    background:
      conic-gradient(
        from 225deg,
        var(--accent) 0 var(--dial-fill),
        color-mix(in srgb, var(--border) 78%, transparent) var(--dial-fill) 75%,
        transparent 75% 100%
      );
    cursor: ns-resize;
    touch-action: none;
  }

  .parameter-control.automated .dial {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .dial:disabled {
    cursor: not-allowed;
    opacity: 0.58;
  }

  .dial-face {
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 50% 42%, var(--surface-elevated), var(--surface));
    box-shadow:
      inset 0 0 0 var(--border-width) color-mix(in srgb, var(--text) 9%, transparent),
      0 1px 0 color-mix(in srgb, var(--text) 8%, transparent);
  }

  .dial-pointer {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 2px;
    height: 13px;
    border-radius: 999px;
    background: var(--text);
    transform-origin: 50% 88%;
    transform: translate(-50%, -88%) rotate(var(--dial-angle));
  }

  .number-control strong {
    min-width: 0;
    color: var(--text);
    font-size: var(--font-size-xs);
    text-align: right;
    text-transform: none;
  }

  .number-control small {
    color: var(--text);
    font-size: var(--font-size-xs);
    text-transform: none;
  }
</style>
