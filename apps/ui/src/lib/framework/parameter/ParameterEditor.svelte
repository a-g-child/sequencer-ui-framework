<script lang="ts">
  import type {
    DeviceParameterDescriptor,
    DeviceParameterValue
  } from '@sequencer/device'
  import BooleanParameter from './BooleanParameter.svelte'
  import ChoiceParameter from './ChoiceParameter.svelte'
  import NumberParameter from './NumberParameter.svelte'
  import TextParameter from './TextParameter.svelte'

  export let descriptor: DeviceParameterDescriptor
  export let value: DeviceParameterValue
  export let disabled = false
  export let automated = false
  export let onChange: (value: DeviceParameterValue) => void = () => {}
</script>

{#if descriptor.kind === 'number'}
  <NumberParameter {descriptor} {value} {disabled} {automated} {onChange} />
{:else if descriptor.kind === 'boolean'}
  <BooleanParameter {descriptor} {value} {disabled} {onChange} />
{:else if descriptor.kind === 'choice'}
  <ChoiceParameter {descriptor} {value} {disabled} {onChange} />
{:else}
  <TextParameter {descriptor} {value} {disabled} {onChange} />
{/if}
