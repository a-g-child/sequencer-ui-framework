<script lang="ts">
  import type { Track } from '@sequencer/core'
  import {
    LFO_DESCRIPTOR,
    type DeviceInstance,
    type DeviceParameterDescriptor,
    type DeviceParameterValue,
    type SampleSlot
  } from '@sequencer/device'
  import ParameterEditor from '../framework/parameter/ParameterEditor.svelte'
  import NumberParameter from '../framework/parameter/NumberParameter.svelte'

  type DeviceParameterView = {
    device: DeviceInstance
    descriptor: DeviceParameterDescriptor
    value: DeviceParameterValue
    runtimeValue?: DeviceParameterValue
    automated?: boolean
  }

  type SamplerSlotView = SampleSlot & {
    loaded: boolean
    label: string
  }

  type LfoModulationTargetOption = {
    id: string
    deviceId: string
    parameterKey: string
    label: string
  }

  type DeviceModuleKind = 'basic-synth' | 'sampler'
  type MidiDeviceModuleKind = 'arpeggiator' | 'lfo'
  type AudioEffectModuleKind = 'delay'

  export let selectedTrack: Track | undefined = undefined
  export let selectedTrackId = ''
  export let selectedTrackDeviceName = 'No device'
  export let selectedTrackDeviceKind: DeviceModuleKind | undefined = undefined
  export let selectedTrackDeviceParameterViews: DeviceParameterView[] = []
  export let selectedTrackMidiDeviceKind: MidiDeviceModuleKind | undefined = undefined
  export let selectedTrackMidiDeviceParameterViews: DeviceParameterView[] = []
  export let selectedTrackHasLfo = false
  export let selectedTrackLfoDevice: DeviceInstance | undefined = undefined
  export let selectedTrackLfoParameterViews: DeviceParameterView[] = []
  export let lfoModulationTargetOptions: LfoModulationTargetOption[] = []
  export let selectedTrackAudioEffectKind: AudioEffectModuleKind | undefined = undefined
  export let selectedTrackAudioEffectParameterViews: DeviceParameterView[] = []
  export let samplerSampleName = 'No sample'
  export let samplerSlot: SampleSlot | undefined = undefined
  export let samplerSlots: SamplerSlotView[] = []
  export let selectedSamplerSlotId = 'slot-1'
  export let samplerSampleStatus = ''
  export let onLoadSamplerSampleFile: (file: File) => void
  export let onSetSamplerSampleSlot: (slot: SampleSlot) => void
  export let onSelectSamplerSlot: (slotId: string) => void
  export let onSetDeviceParameterValue: (
    deviceInstanceId: string,
    parameterKey: string,
    value: DeviceParameterValue
  ) => void
  export let onAttachDevice: (kind: DeviceModuleKind) => void
  export let onAttachMidiDevice: (kind: MidiDeviceModuleKind) => void
  export let onRemoveMidiDevice: (kind: MidiDeviceModuleKind) => void
  export let onAttachAudioEffect: (kind: AudioEffectModuleKind) => void
  export let onRemoveAudioEffect: (kind: AudioEffectModuleKind) => void
  export let onRemoveDevice: () => void
  let deviceChooserOpen = false
  const samplerNumberDescriptors: Record<string, DeviceParameterDescriptor> = {
    rootNote: {
      id: 'sampler-slot-root-note',
      key: 'rootNote',
      name: 'Root',
      kind: 'number',
      defaultValue: 36,
      min: 0,
      max: 127,
      step: 1
    },
    gain: {
      id: 'sampler-slot-gain',
      key: 'gain',
      name: 'Gain',
      kind: 'number',
      defaultValue: 1,
      min: 0,
      max: 4,
      step: 0.01
    },
    start: {
      id: 'sampler-slot-start',
      key: 'start',
      name: 'Start',
      kind: 'number',
      defaultValue: 0,
      min: 0,
      max: 30,
      step: 0.001,
      unit: 's'
    },
    end: {
      id: 'sampler-slot-end',
      key: 'end',
      name: 'End',
      kind: 'number',
      defaultValue: 0,
      min: 0,
      max: 30,
      step: 0.001,
      unit: 's'
    },
    loopStart: {
      id: 'sampler-slot-loop-start',
      key: 'loopStart',
      name: 'Loop Start',
      kind: 'number',
      defaultValue: 0,
      min: 0,
      max: 30,
      step: 0.001,
      unit: 's'
    },
    loopEnd: {
      id: 'sampler-slot-loop-end',
      key: 'loopEnd',
      name: 'Loop End',
      kind: 'number',
      defaultValue: 0,
      min: 0,
      max: 30,
      step: 0.001,
      unit: 's'
    }
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

  function updateSamplerNumber(
    key: keyof SampleSlot,
    value: DeviceParameterValue
  ): void {
    if (typeof value !== 'number') return

    updateSamplerSlot({ [key]: value })
  }

  function attachDevice(kind: DeviceModuleKind): void {
    onAttachDevice(kind)
    deviceChooserOpen = false
  }

  function audioEffectParameterView(
    key: string
  ): DeviceParameterView | undefined {
    return selectedTrackAudioEffectParameterViews.find(
      (parameter) => parameter.descriptor.key === key
    )
  }

  function audioEffectParameterValue(key: string): DeviceParameterValue | undefined {
    const parameter = audioEffectParameterView(key)

    return parameter?.runtimeValue ?? parameter?.value
  }

  function setAudioEffectParameter(
    key: string,
    value: DeviceParameterValue
  ): void {
    const parameter = audioEffectParameterView(key)

    if (!parameter) return

    onSetDeviceParameterValue(parameter.device.id, parameter.descriptor.key, value)
  }

  function setLfoParameter(key: string, value: DeviceParameterValue): void {
    const parameter = lfoParameterViews.find(
      (candidate) => candidate.descriptor.key === key
    )
    const deviceId = parameter?.device.id ?? selectedTrackLfoDevice?.id

    if (!deviceId) return

    onSetDeviceParameterValue(deviceId, key, value)
  }

  function setLfoTarget(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value
    const [deviceId = '', parameterKey = ''] = value.split(':')

    setLfoParameter('targetDeviceId', deviceId)
    setLfoParameter('targetParameterKey', parameterKey)
  }

  function buildLfoParameterViews(
    suppliedDevice: DeviceInstance | undefined,
    suppliedViews: DeviceParameterView[]
  ): DeviceParameterView[] {
    const lfoDevice = suppliedDevice ?? suppliedViews[0]?.device

    if (!lfoDevice) return []

    return LFO_DESCRIPTOR.parameters.map((descriptor) => {
      const existing = suppliedViews.find(
        (parameter) => parameter.descriptor.key === descriptor.key
      )

      return existing ?? {
        device: lfoDevice,
        descriptor,
        value: lfoDevice.parameterValues[descriptor.key] ?? descriptor.defaultValue
      }
    })
  }

  $: delayModeParameter = selectedTrackAudioEffectParameterViews.find(
    (parameter) => parameter.descriptor.key === 'timeMode'
  )
  $: delayDivisionParameter = selectedTrackAudioEffectParameterViews.find(
    (parameter) => parameter.descriptor.key === 'syncDivision'
  )
  $: delayTimeParameter = selectedTrackAudioEffectParameterViews.find(
    (parameter) => parameter.descriptor.key === 'time'
  )
  $: delayFeedbackParameter = selectedTrackAudioEffectParameterViews.find(
    (parameter) => parameter.descriptor.key === 'feedback'
  )
  $: delayMixParameter = selectedTrackAudioEffectParameterViews.find(
    (parameter) => parameter.descriptor.key === 'mix'
  )
  $: delayMode = String(
    (delayModeParameter?.runtimeValue ?? delayModeParameter?.value) ?? 'free'
  )
  $: delayContinuousParameters = [
    delayFeedbackParameter,
    delayMixParameter
  ].filter((parameter): parameter is DeviceParameterView => Boolean(parameter))
  $: lfoParameterViews = buildLfoParameterViews(
    selectedTrackLfoDevice,
    selectedTrackLfoParameterViews
  )
  $: lfoTargetDeviceParameter = lfoParameterViews.find(
    (parameter) => parameter.descriptor.key === 'targetDeviceId'
  )
  $: lfoTargetParameterParameter = lfoParameterViews.find(
    (parameter) => parameter.descriptor.key === 'targetParameterKey'
  )
  $: selectedLfoTargetId = [
    String(lfoTargetDeviceParameter?.runtimeValue ?? lfoTargetDeviceParameter?.value ?? ''),
    String(lfoTargetParameterParameter?.runtimeValue ?? lfoTargetParameterParameter?.value ?? '')
  ].join(':')
  $: lfoControlParameters = lfoParameterViews.filter(
    (parameter) =>
      parameter.descriptor.key !== 'targetDeviceId' &&
      parameter.descriptor.key !== 'targetParameterKey'
  )
</script>

<section class="track-modules" aria-label="Selected track options">
  <div class="track-module track-module-summary">
    <span>Selected Track</span>
    <strong>{selectedTrack?.name ?? 'None'}</strong>
  </div>

  <section class="track-module track-device-module" aria-label="Track device">
    {#if !selectedTrackId}
      <div class="empty-device-slot">
        <span>No track selected</span>
      </div>
    {:else if !selectedTrackDeviceKind}
      <div class="empty-device-slot">
        <button
          type="button"
          class="add-device-button"
          aria-expanded={deviceChooserOpen}
          on:click={() => (deviceChooserOpen = !deviceChooserOpen)}
        >
          +
        </button>
        {#if deviceChooserOpen}
          <div class="device-chooser" aria-label="Available devices">
            <button type="button" on:click={() => attachDevice('basic-synth')}>
              Basic Synth
            </button>
            <button type="button" on:click={() => attachDevice('sampler')}>
              Sampler
            </button>
          </div>
        {/if}
      </div>
    {:else}
      <div class="device-chain">
        <section class="device-module midi-module" aria-label="MIDI device chain">
          <div class="midi-device-stack">
            {#if selectedTrackMidiDeviceKind === 'arpeggiator'}
              <div class="midi-device-card">
                <div class="midi-device-heading">
                  <div>
                    <span>MIDI FX</span>
                    <strong>Arpeggiator</strong>
                  </div>
                  <button
                    type="button"
                    class="remove-device-button"
                    aria-label="Remove Arpeggiator"
                    title="Remove Arpeggiator"
                    on:click={() => onRemoveMidiDevice('arpeggiator')}
                  >
                    x
                  </button>
                </div>
                {#if selectedTrackMidiDeviceParameterViews.length > 0}
                  <div class="parameter-module-grid midi-parameter-grid">
                    {#each selectedTrackMidiDeviceParameterViews as parameter (`${parameter.device.id}:${parameter.descriptor.key}`)}
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
                {/if}
              </div>
            {/if}

            {#if selectedTrackHasLfo}
              <div class="midi-device-card">
                <div class="midi-device-heading">
                  <div>
                    <span>MIDI FX</span>
                    <strong>LFO</strong>
                  </div>
                  <button
                    type="button"
                    class="remove-device-button"
                    aria-label="Remove LFO"
                    title="Remove LFO"
                    on:click={() => onRemoveMidiDevice('lfo')}
                  >
                    x
                  </button>
                </div>

                <div class="lfo-grid">
                  <label class="lfo-target-parameter">
                    <span>Target</span>
                    <select
                      disabled={!selectedTrackId || lfoModulationTargetOptions.length === 0}
                      value={selectedLfoTargetId}
                      on:change={setLfoTarget}
                    >
                      <option value=":">None</option>
                      {#each lfoModulationTargetOptions as option (option.id)}
                        <option value={`${option.deviceId}:${option.parameterKey}`}>
                          {option.label}
                        </option>
                      {/each}
                    </select>
                  </label>

                  {#each lfoControlParameters as parameter (`${parameter.device.id}:${parameter.descriptor.key}`)}
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
              </div>
            {/if}

            <div class="insert-midi-device-grid">
              {#if selectedTrackMidiDeviceKind !== 'arpeggiator'}
                <button
                  type="button"
                  class="insert-midi-device-button"
                  on:click={() => onAttachMidiDevice('arpeggiator')}
                >
                  + Arp
                </button>
              {/if}
              {#if !selectedTrackHasLfo}
                <button
                  type="button"
                  class="insert-midi-device-button"
                  on:click={() => onAttachMidiDevice('lfo')}
                >
                  + LFO
                </button>
              {/if}
            </div>
          </div>
        </section>

        <section class="device-module instrument-module" aria-label="Instrument">
          <div class="module-heading device-heading">
            <div>
              <h2>{selectedTrackDeviceName}</h2>
              <span>{selectedTrackDeviceKind === 'sampler' ? 'Sampler' : 'Synth'}</span>
            </div>
            <button
              type="button"
              class="remove-device-button"
              aria-label={`Remove ${selectedTrackDeviceName}`}
              title="Remove device"
              on:click={onRemoveDevice}
            >
              x
            </button>
          </div>

          <div class="device-module-layout">
            {#if selectedTrackDeviceKind === 'sampler'}
              <section class="sampler-panel" aria-label="Sampler slots">
                <div class="sample-slot-selector">
                  {#each samplerSlots as slot, index (slot.id)}
                    <button
                      type="button"
                      class:active={slot.id === selectedSamplerSlotId}
                      class:loaded={slot.loaded}
                      aria-pressed={slot.id === selectedSamplerSlotId}
                      title={slot.label}
                      on:click={() => onSelectSamplerSlot(slot.id)}
                    >
                      <strong>{index + 1}</strong>
                      <span>{slot.loaded ? slot.label : slot.rootNote}</span>
                    </button>
                  {/each}
                </div>

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
                  <NumberParameter
                    descriptor={samplerNumberDescriptors.rootNote}
                    value={samplerSlot.rootNote}
                    onChange={(value) => updateSamplerNumber('rootNote', value)}
                  />
                  <NumberParameter
                    descriptor={samplerNumberDescriptors.gain}
                    value={samplerSlot.gain}
                    onChange={(value) => updateSamplerNumber('gain', value)}
                  />
                  <NumberParameter
                    descriptor={samplerNumberDescriptors.start}
                    value={samplerSlot.start}
                    onChange={(value) => updateSamplerNumber('start', value)}
                  />
                  <NumberParameter
                    descriptor={samplerNumberDescriptors.end}
                    value={samplerSlot.end ?? samplerSlot.start}
                    onChange={(value) => updateSamplerNumber('end', value)}
                  />
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
                  <NumberParameter
                    descriptor={samplerNumberDescriptors.loopStart}
                    value={samplerSlot.loopStart ?? samplerSlot.start}
                    disabled={!samplerSlot.loop}
                    onChange={(value) => updateSamplerNumber('loopStart', value)}
                  />
                  <NumberParameter
                    descriptor={samplerNumberDescriptors.loopEnd}
                    value={samplerSlot.loopEnd ?? samplerSlot.end ?? samplerSlot.start}
                    disabled={!samplerSlot.loop}
                    onChange={(value) => updateSamplerNumber('loopEnd', value)}
                  />
                </div>
              {/if}
              </section>
            {/if}

            <section class="device-parameter-panel" aria-label="Device parameters">
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
          </div>
        </section>

        <section class="device-module effect-module" aria-label="Audio effect chain">
          {#if selectedTrackAudioEffectKind === 'delay'}
            <div class="effect-device-heading">
              <div>
                <span>Audio FX</span>
                <strong>Delay</strong>
              </div>
              <button
                type="button"
                class="remove-device-button"
                aria-label="Remove Delay"
                title="Remove Delay"
                on:click={() => onRemoveAudioEffect('delay')}
              >
                x
              </button>
            </div>
            <div class="delay-effect-grid">
              {#if delayModeParameter}
                <div class="segmented-parameter" aria-label="Delay time mode">
                  <span>{delayModeParameter.descriptor.name}</span>
                  <div class="segmented-control">
                    {#each delayModeParameter.descriptor.options ?? [] as option (option.value)}
                      <button
                        type="button"
                        class:active={String(delayModeParameter.runtimeValue ?? delayModeParameter.value) === option.value}
                        aria-pressed={String(delayModeParameter.runtimeValue ?? delayModeParameter.value) === option.value}
                        disabled={!selectedTrackId}
                        on:click={() => setAudioEffectParameter('timeMode', option.value)}
                      >
                        {option.label}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if delayDivisionParameter && delayMode === 'sync'}
                <div class="division-grid-parameter" aria-label="Delay sync division">
                  <span>{delayDivisionParameter.descriptor.name}</span>
                  <div class="division-grid">
                    {#each delayDivisionParameter.descriptor.options ?? [] as option (option.value)}
                      <button
                        type="button"
                        class:active={String(delayDivisionParameter.runtimeValue ?? delayDivisionParameter.value) === option.value}
                        aria-pressed={String(delayDivisionParameter.runtimeValue ?? delayDivisionParameter.value) === option.value}
                        disabled={!selectedTrackId}
                        on:click={() => setAudioEffectParameter('syncDivision', option.value)}
                      >
                        {option.label}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if delayTimeParameter}
                <ParameterEditor
                  descriptor={delayTimeParameter.descriptor}
                  value={delayTimeParameter.runtimeValue ?? delayTimeParameter.value}
                  disabled={!selectedTrackId || delayMode === 'sync'}
                  automated={delayTimeParameter.automated ?? false}
                  onChange={(value) => setAudioEffectParameter('time', value)}
                />
              {/if}

              {#each delayContinuousParameters as parameter (`${parameter.device.id}:${parameter.descriptor.key}`)}
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

              {#if selectedTrackAudioEffectParameterViews.length === 0}
                <p class="empty-module">Delay parameters unavailable</p>
              {/if}
            </div>
          {:else}
            <button
              type="button"
              class="insert-effect-device-button"
              on:click={() => onAttachAudioEffect('delay')}
            >
              + Delay
            </button>
          {/if}
        </section>
      </div>
    {/if}
  </section>
</section>

<style>
  .track-modules {
    display: grid;
    grid-template-columns: minmax(140px, 0.36fr) minmax(760px, 1.64fr);
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

  .track-device-module {
    align-content: start;
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

  .device-heading {
    align-items: start;
  }

  .device-heading > div {
    min-width: 0;
    display: grid;
    gap: var(--spacing-2xs);
  }

  .device-chain {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--spacing-md);
    align-items: start;
  }

  .device-module {
    min-width: 0;
    display: grid;
    align-content: start;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm);
    border: var(--border-width) solid var(--border);
    background: var(--surface-2);
  }

  .midi-device-heading,
  .effect-device-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--spacing-sm);
  }

  .midi-device-heading > div,
  .effect-device-heading > div {
    min-width: 0;
    display: grid;
    gap: var(--spacing-2xs);
  }

  .midi-device-heading span,
  .effect-device-heading span {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .midi-device-heading strong,
  .effect-device-heading strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--font-size-sm);
  }

  .midi-device-stack,
  .midi-device-card,
  .lfo-grid,
  .insert-midi-device-grid {
    min-width: 0;
    display: grid;
    gap: var(--spacing-sm);
  }

  .midi-device-card {
    padding-bottom: var(--spacing-sm);
    border-bottom: var(--border-width) solid var(--border);
  }

  .midi-device-card:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .lfo-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .lfo-target-parameter {
    min-width: 0;
    display: grid;
    grid-column: 1 / -1;
    gap: var(--spacing-2xs);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .lfo-target-parameter select {
    min-width: 0;
    min-height: var(--control-height-sm);
    padding: 0 var(--spacing-xs);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-size-xs);
  }

  .lfo-target-parameter select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .insert-midi-device-button,
  .insert-effect-device-button {
    justify-self: stretch;
    min-height: var(--control-height-sm);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .insert-midi-device-button:hover,
  .insert-effect-device-button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .midi-parameter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .delay-effect-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .delay-effect-grid {
    display: grid;
    gap: var(--spacing-sm);
  }

  .segmented-parameter,
  .division-grid-parameter {
    min-width: 0;
    display: grid;
    grid-column: 1 / -1;
    gap: var(--spacing-2xs);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .segmented-control,
  .division-grid {
    display: grid;
    gap: var(--spacing-2xs);
  }

  .segmented-control {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .division-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .segmented-control button,
  .division-grid button {
    min-width: 0;
    min-height: var(--control-height-sm);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
  }

  .segmented-control button.active,
  .division-grid button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .remove-device-button {
    width: var(--icon-button-size);
    min-width: var(--icon-button-size);
    height: var(--icon-button-size);
    padding: 0;
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 900;
    line-height: 1;
  }

  .remove-device-button:hover {
    border-color: var(--danger, var(--accent));
    color: var(--danger, var(--accent));
  }

  .empty-device-slot {
    min-height: 124px;
    display: grid;
    place-items: center;
    gap: var(--spacing-sm);
    border: var(--border-width) dashed var(--border);
    background: var(--surface-2);
  }

  .empty-device-slot > span {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .add-device-button {
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    color: var(--muted);
    font-size: var(--font-size-xl);
    font-weight: 900;
    line-height: 1;
  }

  .add-device-button:hover,
  .add-device-button[aria-expanded='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .device-chooser {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 120px));
    gap: var(--spacing-xs);
  }

  .device-chooser button {
    min-height: var(--control-height-sm);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .device-chooser button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .parameter-module-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--spacing-sm);
  }

  .device-module-layout {
    min-width: 0;
    display: grid;
    grid-template-columns: 1fr;
    align-items: start;
    gap: var(--spacing-md);
  }

  .sampler-panel,
  .device-parameter-panel {
    min-width: 0;
    display: grid;
    gap: var(--spacing-sm);
  }

  .output-status {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 700;
    text-transform: none;
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

  .sample-slot-selector {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--spacing-2xs);
  }

  .sample-slot-selector button {
    min-width: 0;
    min-height: 52px;
    display: grid;
    align-content: center;
    gap: 1px;
    padding: var(--spacing-2xs);
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
  }

  .sample-slot-selector button.loaded {
    border-color: var(--accent);
    color: var(--text);
  }

  .sample-slot-selector button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .sample-slot-selector strong,
  .sample-slot-selector span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sample-slot-selector span {
    font-size: 10px;
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--spacing-sm);
  }

  .sample-slot-toggle {
    min-width: 0;
    display: grid;
    gap: var(--spacing-2xs);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
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

    .device-module-layout {
      grid-template-columns: 1fr;
    }

    .device-chain {
      grid-template-columns: 1fr;
    }

    .parameter-module-grid,
    .sample-slot-grid,
    .sample-slot-selector {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .device-parameter-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
