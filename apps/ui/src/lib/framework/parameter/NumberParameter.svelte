<script lang="ts">
  import type {
    DeviceParameterDescriptor,
    DeviceParameterValue
  } from '@sequencer/device'

  export let descriptor: DeviceParameterDescriptor
  export let value: DeviceParameterValue
  export let disabled = false
  export let onChange: (value: DeviceParameterValue) => void = () => {}

  $: numberValue = Number(value ?? descriptor.defaultValue)
  $: displayValue = Number.isFinite(numberValue) ? numberValue : 0

  function commit(event: Event) {
    const nextValue = Number((event.currentTarget as HTMLInputElement).value)

    if (Number.isFinite(nextValue)) {
      onChange(nextValue)
    }
  }
</script>

<label class="parameter-control">
  <span>{descriptor.name}</span>
  <div class="number-control">
    <input
      type="range"
      min={descriptor.min ?? 0}
      max={descriptor.max ?? 1}
      step={descriptor.step ?? 0.01}
      value={displayValue}
      on:input={commit}
      disabled={disabled}
    />
    <input
      class="number-field"
      type="number"
      min={descriptor.min}
      max={descriptor.max}
      step={descriptor.step ?? 0.01}
      value={displayValue}
      on:change={commit}
      disabled={disabled}
    />
    {#if descriptor.unit}
      <strong>{descriptor.unit}</strong>
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

  .number-control {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(72px, 1fr) minmax(56px, 0.55fr) auto;
    align-items: center;
    gap: var(--spacing-2xs);
  }

  .number-control input[type='range'] {
    min-width: 0;
    width: 100%;
  }

  .number-field {
    min-width: 0;
    width: 100%;
    min-height: var(--control-height-sm);
    padding: 0 var(--spacing-xs);
    border: var(--border-width) solid var(--border);
    background: var(--surface-elevated);
    color: var(--text);
    font: inherit;
  }

  .number-control strong {
    color: var(--text);
    font-size: var(--font-size-xs);
    text-transform: none;
  }
</style>
