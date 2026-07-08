<script lang="ts">
  import type {
    ParameterValue,
    Track
  } from '@sequencer/core'
  import type {
    DeviceInstance,
    DeviceParameterDescriptor,
    DeviceParameterValue,
    SampleSlot
  } from '@sequencer/device'
  import type { InspectorPropertyView } from '../inspector/inspector-model'
  import ParameterEditor from '../framework/parameter/ParameterEditor.svelte'

  type DeviceParameterView = {
    device: DeviceInstance
    descriptor: DeviceParameterDescriptor
    value: DeviceParameterValue
    runtimeValue?: DeviceParameterValue
    automated?: boolean
  }

  export let selectedTrack: Track | undefined = undefined
  export let selectedTrackId = ''
  export let selectedTrackParameterViews: InspectorPropertyView[] = []
  export let selectedTrackDeviceName = 'No device'
  export let selectedTrackDeviceParameterViews: DeviceParameterView[] = []
  export let webAudioEnabled = false
  export let webMidiEnabled = false
  export let webMidiLabel = 'MIDI'
  export let webMidiStatus = ''
  export let samplerSampleName = 'No sample'
  export let samplerSlot: SampleSlot | undefined = undefined
  export let samplerSampleStatus = ''
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
  export let onToggleWebMidiOutput: () => void
  export let onLoadSamplerSampleFile: (file: File) => void
  export let onSetSamplerSampleSlot: (slot: SampleSlot) => void
  export let onSetDeviceParameterValue: (
    deviceInstanceId: string,
    parameterKey: string,
    value: DeviceParameterValue
  ) => void

  function readNumberValue(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value)
  }

  function loadSamplerFile(event: Event): void {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]

    if (file) {
      onLoadSamplerSampleFile(file)
    }
  }

  function updateSamplerSlot(patch: Partial<SampleSlot>): void {
    if (!samplerSlot) return

    onSetSamplerSampleSlot({
      ...samplerSlot,
      ...patch
    })
  }

  function readOptionalNumberValue(event: Event): number | undefined {
    const value = (event.currentTarget as HTMLInputElement).value

    return value === '' ? undefined : Number(value)
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
      <div class="audio-toggle">
        <span>{webMidiLabel}</span>
        <button
          type="button"
          class="audio-enable-button"
          class:active={webMidiEnabled}
          aria-pressed={webMidiEnabled}
          title={webMidiStatus}
          on:click={onToggleWebMidiOutput}
        >
          {webMidiEnabled ? 'On' : 'Off'}
        </button>
      </div>
      {#if webMidiStatus && !webMidiEnabled}
        <p class="output-status">{webMidiStatus}</p>
      {/if}
    </div>

    {#if selectedTrackId}
      <div class="sample-loader">
        <span>{samplerSampleName}</span>
        <label class="sample-load-button">
          Load
          <input
            type="file"
            accept="audio/*"
            on:change={loadSamplerFile}
            disabled={!selectedTrackId}
          />
        </label>
        {#if samplerSampleStatus}
          <p class="output-status">{samplerSampleStatus}</p>
        {/if}
      </div>

      {#if samplerSlot}
        <div class="sample-slot-grid" aria-label="Sample slot settings">
          <label class="sample-slot-control">
            <span>Root</span>
            <input
              type="number"
              min="0"
              max="127"
              step="1"
              value={samplerSlot.rootNote}
              on:change={(event) =>
                updateSamplerSlot({ rootNote: readNumberValue(event) })}
            />
          </label>
          <label class="sample-slot-control">
            <span>Gain</span>
            <input
              type="number"
              min="0"
              max="4"
              step="0.01"
              value={samplerSlot.gain}
              on:change={(event) =>
                updateSamplerSlot({ gain: readNumberValue(event) })}
            />
          </label>
          <label class="sample-slot-control">
            <span>Start</span>
            <input
              type="number"
              min="0"
              step="0.001"
              value={samplerSlot.start}
              on:change={(event) =>
                updateSamplerSlot({ start: readNumberValue(event) })}
            />
          </label>
          <label class="sample-slot-control">
            <span>End</span>
            <input
              type="number"
              min="0"
              step="0.001"
              value={samplerSlot.end ?? ''}
              on:change={(event) =>
                updateSamplerSlot({ end: readOptionalNumberValue(event) })}
            />
          </label>
          <label class="sample-slot-toggle">
            <span>Loop</span>
            <button
              type="button"
              class:active={samplerSlot.loop}
              aria-pressed={samplerSlot.loop}
              on:click={() => updateSamplerSlot({ loop: !samplerSlot.loop })}
            >
              {samplerSlot.loop ? 'On' : 'Off'}
            </button>
          </label>
          <label class="sample-slot-control">
            <span>Loop Start</span>
            <input
              type="number"
              min="0"
              step="0.001"
              value={samplerSlot.loopStart ?? samplerSlot.start}
              disabled={!samplerSlot.loop}
              on:change={(event) =>
                updateSamplerSlot({ loopStart: readOptionalNumberValue(event) })}
            />
          </label>
          <label class="sample-slot-control">
            <span>Loop End</span>
            <input
              type="number"
              min="0"
              step="0.001"
              value={samplerSlot.loopEnd ?? samplerSlot.end ?? ''}
              disabled={!samplerSlot.loop}
              on:change={(event) =>
                updateSamplerSlot({ loopEnd: readOptionalNumberValue(event) })}
            />
          </label>
        </div>
      {/if}
    {/if}

    {#if selectedTrackDeviceParameterViews.length > 0}
      <div class="parameter-module-grid device-parameter-grid">
        {#each selectedTrackDeviceParameterViews as parameter (`${parameter.device.id}:${parameter.descriptor.key}`)}
          <ParameterEditor
            descriptor={parameter.descriptor}
            value={parameter.runtimeValue ?? parameter.value}
            disabled={!selectedTrackId}
            automated={parameter.automated ?? false}
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

  .output-status {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 700;
    text-transform: none;
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

  .sample-loader {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--spacing-sm);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .sample-loader span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .sample-load-button {
    min-height: var(--control-height-sm);
    min-width: 56px;
    display: inline-grid;
    place-items: center;
    padding: 0 var(--spacing-sm);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    color: var(--muted);
    cursor: pointer;
  }

  .sample-load-button:focus-within,
  .sample-load-button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .sample-load-button input {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .sample-slot-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--spacing-sm);
  }

  .sample-slot-control,
  .sample-slot-toggle {
    min-width: 0;
    display: grid;
    gap: var(--spacing-2xs);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .sample-slot-control input {
    min-width: 0;
    min-height: var(--control-height-sm);
    padding: 0 var(--spacing-xs);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }

  .sample-slot-control input:disabled {
    opacity: 0.45;
  }

  .sample-slot-toggle button {
    min-height: var(--control-height-sm);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
  }

  .sample-slot-toggle button.active {
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
    .audio-output-panel,
    .sample-slot-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .device-parameter-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
