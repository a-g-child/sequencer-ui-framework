<script lang="ts">
  import type {
    DeviceParameterDescriptor,
    DeviceParameterValue
  } from '@sequencer/device'

  export let descriptor: DeviceParameterDescriptor
  export let value: DeviceParameterValue
  export let disabled = false
  export let onChange: (value: DeviceParameterValue) => void = () => {}
</script>

<label class="parameter-control">
  <span>{descriptor.name}</span>
  <input
    value={String(value ?? descriptor.defaultValue)}
    on:change={(event) =>
      onChange((event.currentTarget as HTMLInputElement).value)}
    disabled={disabled}
  />
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

  input {
    min-width: 0;
    width: 100%;
    min-height: var(--control-height-sm);
    padding: 0 var(--spacing-xs);
    border: var(--border-width) solid var(--border);
    background: var(--surface-elevated);
    color: var(--text);
    font: inherit;
  }
</style>
