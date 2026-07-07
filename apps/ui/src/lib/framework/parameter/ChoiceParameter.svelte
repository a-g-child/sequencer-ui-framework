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
  <select
    value={String(value ?? descriptor.defaultValue)}
    on:change={(event) =>
      onChange((event.currentTarget as HTMLSelectElement).value)}
    disabled={disabled}
  >
    {#each descriptor.options ?? [] as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
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

  select {
    min-width: 0;
    width: 100%;
    min-height: var(--control-height-sm);
  }
</style>
