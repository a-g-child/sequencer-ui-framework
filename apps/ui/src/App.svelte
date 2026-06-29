<script lang="ts">
  import { onMount } from 'svelte'
  import {
    AddTrackOperation,
    RenameEntityOperation,
    SetParameterValueOperation,
    SequencerApplication,
    validateDocument,
    type Parameter,
    type ParameterDefinition,
    type ParameterValue,
    type Track
  } from '@sequencer/core'

  interface PropertyRow {
    parameter: Parameter
    definition?: ParameterDefinition
    value: ParameterValue
  }

  const app = new SequencerApplication()
  const store = app.documentStore

  onMount(() => {
    void app.initialise()

    return () => {
      void app.shutdown()
    }
  })

  let tracks = store.document.tracks.values()
  let selectedTrackId = tracks[0]?.id ?? ''
  let selectedTrack: Track | undefined = tracks[0]
  let selectedProperties = buildPropertyRows(selectedTrack)
  let draftName = selectedTrack?.name ?? ''
  let numberDrafts: Record<string, number> = {}
  let issues = validateDocument(store.document)
  let canUndo = store.history.canUndo()
  let canRedo = store.history.canRedo()

  function buildPropertyRows(track: Track | undefined): PropertyRow[] {
    if (!track) return []

    return track.parameters.flatMap((parameterId) => {
      const parameter = store.document.parameters.find(parameterId)

      if (!parameter) return []

      return [
        {
          parameter,
          definition: store.document.parameterDefinitions.find(
            parameter.definitionId
          ),
          value: parameter.value
        }
      ]
    })
  }

  function syncView() {
    tracks = store.document.tracks.values()

    if (selectedTrackId && !store.document.tracks.has(selectedTrackId)) {
      selectedTrackId = tracks[0]?.id ?? ''
    }

    selectedTrack = selectedTrackId
      ? store.document.tracks.find(selectedTrackId)
      : undefined
    selectedProperties = buildPropertyRows(selectedTrack)
    draftName = selectedTrack?.name ?? ''
    issues = validateDocument(store.document)
    canUndo = store.history.canUndo()
    canRedo = store.history.canRedo()
  }

  function selectTrack(track: Track) {
    selectedTrackId = track.id
    store.setSelection([track.id])
    syncView()
  }

  function addTrack() {
    const nextNumber = tracks.length + 1
    store.execute(new AddTrackOperation(`Track ${nextNumber}`, `Pattern ${nextNumber}`))
    const nextTrack = store.document.tracks.values().at(-1)

    if (nextTrack) {
      selectedTrackId = nextTrack.id
      store.setSelection([nextTrack.id])
    }

    syncView()
  }

  function renameSelectedTrack() {
    const nextName = draftName.trim()

    if (!selectedTrack || !nextName || nextName === selectedTrack.name) {
      draftName = selectedTrack?.name ?? ''
      return
    }

    store.execute(
      new RenameEntityOperation(store.document.tracks, selectedTrack.id, nextName)
    )
    syncView()
  }

  function setParameterValue(parameterId: string, value: ParameterValue) {
    store.execute(new SetParameterValueOperation(parameterId, value))
    syncView()
  }

  function setNumberPreview(parameterId: string, value: number) {
    numberDrafts = {
      ...numberDrafts,
      [parameterId]: value
    }
    selectedProperties = selectedProperties.map((property) =>
      property.parameter.id === parameterId
        ? { ...property, value }
        : property
    )
    store.previewParameterValue(parameterId, value)
  }

  function commitNumberValue(parameterId: string, value: number) {
    const parameter = store.document.parameters.get(parameterId)

    numberDrafts = Object.fromEntries(
      Object.entries(numberDrafts).filter(([id]) => id !== parameterId)
    )

    if (value === parameter.value) {
      syncView()
      return
    }

    setParameterValue(parameterId, value)
  }

  function readNumberValue(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value)
  }

  function readBooleanValue(event: Event): boolean {
    return (event.currentTarget as HTMLInputElement).checked
  }

  function readTextValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value
  }

  function readChoiceValue(
    event: Event,
    definition: ParameterDefinition | undefined
  ): ParameterValue {
    const value = (event.currentTarget as HTMLSelectElement).value
    const option = definition?.options?.find((item) => String(item.value) === value)

    return option?.value ?? value
  }

  function formatParameterValue(parameter: Parameter): string {
    if (typeof parameter.value === 'boolean') {
      return parameter.value ? 'On' : 'Off'
    }

    return String(parameter.value)
  }

  function undo() {
    store.undo()
    syncView()
  }

  function redo() {
    store.redo()
    syncView()
  }
</script>

<main class="editor-shell">
  <header class="topbar">
    <div>
      <p class="eyebrow">Sequencer</p>
      <h1>{store.document.name}</h1>
    </div>

    <div class="toolbar" aria-label="Document operations">
      <button type="button" on:click={addTrack}>Add Track</button>
      <button type="button" on:click={undo} disabled={!canUndo}>Undo</button>
      <button type="button" on:click={redo} disabled={!canRedo}>Redo</button>
    </div>
  </header>

  <section class="workspace" aria-label="Document workspace">
    <aside class="track-pane" aria-label="Tracks">
      <div class="pane-heading">
        <h2>Tracks</h2>
        <span>{tracks.length}</span>
      </div>

      <div class="track-list">
        {#each tracks as track (track.id)}
          <button
            type="button"
            class:selected={track.id === selectedTrackId}
            on:click={() => selectTrack(track)}
          >
            <span>{track.name}</span>
            <small>{track.parameters.length} properties</small>
          </button>
        {/each}
      </div>
    </aside>

    <section class="inspector" aria-label="Inspector">
      {#if selectedTrack}
        <div class="pane-heading">
          <h2>Inspector</h2>
          <span>{selectedTrack.key ?? 'track'}</span>
        </div>

        <form class="rename-form" on:submit|preventDefault={renameSelectedTrack}>
          <label for="track-name">Name</label>
          <div class="rename-row">
            <input id="track-name" bind:value={draftName} />
            <button type="submit">Rename</button>
          </div>
        </form>

        <div class="property-list">
          {#each selectedProperties as property (property.parameter.id)}
            <div class="property-row">
              <label for={`property-${property.parameter.id}`}>
                {property.definition?.name ?? 'Missing property'}
              </label>

              {#if property.definition}
                {#if property.definition.kind === 'number' && typeof property.value === 'number'}
                  <div class="number-property">
                    <input
                      id={`property-${property.parameter.id}`}
                      type="range"
                      min={property.definition.min}
                      max={property.definition.max}
                      step={property.definition.step}
                      value={property.value}
                      on:input={(event) =>
                        setNumberPreview(property.parameter.id, readNumberValue(event))}
                      on:change={(event) =>
                        commitNumberValue(property.parameter.id, readNumberValue(event))}
                    />
                    <input
                      aria-label={`${property.definition.name} value`}
                      type="number"
                      min={property.definition.min}
                      max={property.definition.max}
                      step={property.definition.step}
                      value={property.value}
                      on:input={(event) =>
                        setNumberPreview(property.parameter.id, readNumberValue(event))}
                      on:change={(event) =>
                        commitNumberValue(property.parameter.id, readNumberValue(event))}
                    />
                  </div>
                {:else if property.definition.kind === 'boolean' && typeof property.value === 'boolean'}
                  <input
                    id={`property-${property.parameter.id}`}
                    class="checkbox-property"
                    type="checkbox"
                    checked={property.value}
                    on:change={(event) =>
                      setParameterValue(property.parameter.id, readBooleanValue(event))}
                  />
                {:else if property.definition.kind === 'choice'}
                  <select
                    id={`property-${property.parameter.id}`}
                    value={String(property.value)}
                    on:change={(event) =>
                      setParameterValue(
                        property.parameter.id,
                        readChoiceValue(event, property.definition)
                      )}
                  >
                    {#each property.definition.options ?? [] as option}
                      <option value={String(option.value)}>{option.label}</option>
                    {/each}
                  </select>
                {:else if property.definition.kind === 'text' && typeof property.value === 'string'}
                  <input
                    id={`property-${property.parameter.id}`}
                    value={property.value}
                    on:input={(event) =>
                      setParameterValue(property.parameter.id, readTextValue(event))}
                  />
                {:else}
                  <strong>{formatParameterValue(property.parameter)}</strong>
                {/if}
              {:else}
                <strong>Missing</strong>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state">
          <h2>No Track Selected</h2>
        </div>
      {/if}
    </section>
  </section>

  <footer class="statusbar">
    <span>{store.document.patterns.values().length} patterns</span>
    <span>{store.document.parameterDefinitions.values().length} property types</span>
    <span>{store.document.parameters.values().length} properties</span>
    <span class:ok={issues.length === 0}>{issues.length} issues</span>
  </footer>
</main>
