<script lang="ts">
  import type {
    DeviceParameterDescriptor,
    DeviceParameterValue
  } from '@sequencer/device'

  export let descriptor: DeviceParameterDescriptor
  export let value: DeviceParameterValue
  export let disabled = false
  export let onChange: (value: DeviceParameterValue) => void = () => {}

  $: checked = Boolean(value)
</script>

<label class="parameter-control">
  <span>{descriptor.name}</span>
  <button
    type="button"
    class="boolean-toggle"
    class:active={checked}
    aria-pressed={checked}
    on:click={() => onChange(!checked)}
    disabled={disabled}
  >
    {checked ? 'On' : 'Off'}
  </button>
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

  .boolean-toggle {
    min-height: var(--control-height-sm);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
  }

  .boolean-toggle.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
