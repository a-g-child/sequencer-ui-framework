<script lang="ts">
  import type {
    ParameterValue,
    Track
  } from '@sequencer/core'
  import type {
    DeviceInstance,
    DeviceParameterDescriptor,
    DeviceParameterValue
  } from '@sequencer/device'
  import type { InspectorPropertyView } from '../inspector/inspector-model'
  import ParameterEditor from '../framework/parameter/ParameterEditor.svelte'

  type DeviceParameterView = {
    device: DeviceInstance
    descriptor: DeviceParameterDescriptor
    value: DeviceParameterValue
  }

  export let selectedTrack: Track | undefined = undefined
  export let selectedTrackId = ''
  export let selectedTrackParameterViews: InspectorPropertyView[] = []
  export let selectedTrackDeviceName = 'No device'
  export let selectedTrackDeviceParameterViews: DeviceParameterView[] = []
  export let webAudioEnabled = false
  export let displayedTrackParameterValue: (
    property: InspectorPropertyView
  ) => ParameterValue
  export let onSetNumberPreview: (parameterId: string, value: number) => void
  export let onCommitNumberValue: (parameterId: string, value: number) => void
  export let onSetParameterValue: (
    parameterId: string,
    value: ParameterValue
  ) => void
  export let onToggleBooleanParameter: (property: InspectorPropertyView) => void
  export let onToggleWebAudioOutput: () => void
  export let onSetDeviceParameterValue: (
    deviceInstanceId: string,
    parameterKey: string,
    value: DeviceParameterValue
  ) => void

  function readNumberValue(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value)
  }
</script>

<section class="track-modules" aria-label="Selected track options">
  <div class="track-module track-module-summary">
    <span>Selected Track</span>
    <strong>{selectedTrack?.name ?? 'None'}</strong>
  </div>

  <section class="track-module" aria-label="Track parameters">
    <div class="module-heading">
      <h2>Track</h2>
      <span>Volume / Pan / Mute</span>
    </div>

    <div class="parameter-module-grid">
      {#each selectedTrackParameterViews as property (property.parameter.id)}
        <label class="module-control">
          <span>{property.definition.name}</span>
          {#if property.definition.kind === 'number'}
            <input
              type="range"
              min={property.definition.min ?? 0}
              max={property.definition.max ?? 1}
              step={property.definition.step ?? 0.01}
              value={Number(displayedTrackParameterValue(property))}
              on:input={(event) =>
                onSetNumberPreview(property.parameter.id, readNumberValue(event))}
              on:change={(event) =>
                onCommitNumberValue(property.parameter.id, readNumberValue(event))}
              disabled={!selectedTrackId}
            />
            <strong>{Number(displayedTrackParameterValue(property)).toFixed(2)}</strong>
          {:else if property.definition.kind === 'boolean'}
            <button
              type="button"
              class="module-toggle"
              class:active={Boolean(displayedTrackParameterValue(property))}
              aria-pressed={Boolean(displayedTrackParameterValue(property))}
              on:click={() => onToggleBooleanParameter(property)}
              disabled={!selectedTrackId}
            >
              {Boolean(displayedTrackParameterValue(property)) ? 'On' : 'Off'}
            </button>
          {:else}
            <input
              value={String(displayedTrackParameterValue(property))}
              on:change={(event) =>
                onSetParameterValue(
                  property.parameter.id,
                  (event.currentTarget as HTMLInputElement).value
                )}
              disabled={!selectedTrackId}
            />
          {/if}
        </label>
      {/each}
    </div>
  </section>

  <section class="track-module" aria-label="Track device">
    <div class="module-heading">
      <h2>Device</h2>
      <span>{selectedTrackDeviceName}</span>
    </div>

    <div class="audio-output-panel" aria-label="Audio output">
      <div class="audio-toggle">
        <span>Audio</span>
        <button
          type="button"
          class="audio-enable-button"
          class:active={webAudioEnabled}
          aria-pressed={webAudioEnabled}
          on:click={onToggleWebAudioOutput}
          disabled={!selectedTrackId}
        >
          {webAudioEnabled ? 'On' : 'Off'}
        </button>
      </div>
    </div>

    {#if selectedTrackDeviceParameterViews.length > 0}
      <div class="parameter-module-grid device-parameter-grid">
        {#each selectedTrackDeviceParameterViews as parameter (`${parameter.device.id}:${parameter.descriptor.key}`)}
          <ParameterEditor
            descriptor={parameter.descriptor}
            value={parameter.value}
            disabled={!selectedTrackId}
            onChange={(value) =>
              onSetDeviceParameterValue(
                parameter.device.id,
                parameter.descriptor.key,
                value
              )}
          />
        {/each}
      </div>
    {:else}
      <p class="empty-module">No device parameters</p>
    {/if}
  </section>
</section>

<style>
  .track-modules {
    display: grid;
    grid-template-columns: minmax(140px, 0.7fr) minmax(260px, 1fr) minmax(360px, 1.4fr);
    gap: var(--spacing-lg);
  }

  .track-module {
    min-width: 0;
    padding: var(--spacing-compact);
    border: var(--border-width) solid var(--border);
    background: var(--surface);
    display: grid;
    gap: var(--spacing-sm);
  }

  .track-module-summary {
    align-content: center;
  }

  .track-module-summary span,
  .module-heading span {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .track-module-summary strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--font-size-xl);
  }

  .module-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--spacing-sm);
  }

  .parameter-module-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--spacing-sm);
  }

  .module-control {
    min-width: 0;
    display: grid;
    gap: var(--spacing-2xs);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .module-control strong {
    color: var(--text);
    font-size: var(--font-size-xs);
  }

  .module-toggle {
    min-height: var(--control-height-sm);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
  }

  .module-toggle.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .audio-output-panel {
    display: grid;
    grid-template-columns: auto;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .audio-toggle {
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    justify-content: start;
    gap: var(--spacing-sm);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .audio-enable-button {
    min-height: var(--control-height-sm);
    min-width: 44px;
    padding: 0 var(--spacing-sm);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
  }

  .audio-enable-button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .device-parameter-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .empty-module {
    margin: 0;
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  @media (max-width: 980px) {
    .track-modules {
      grid-template-columns: 1fr;
    }

    .parameter-module-grid,
    .audio-output-panel {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .device-parameter-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
