<script lang="ts">
  import { onMount } from 'svelte'
  import {
    AddTrackOperation,
    MovePatternPlacementOperation,
    RenameEntityOperation,
    ResizePatternPlacementOperation,
    SetParameterValueOperation,
    SequencerApplication,
    validateDocument,
    type BeatTime,
    type ServiceEvent,
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

  interface TimelinePlacementView {
    id: string
    trackId: string
    trackName: string
    patternId: string
    patternName: string
    start: number
    length: number
  }

  const app = new SequencerApplication()
  const store = app.documentStore

  onMount(() => {
    const unsubscribe = app.serviceEvents.subscribe(handleServiceEvent)
    void app.initialise()

    return () => {
      unsubscribe()
      void app.shutdown()
    }
  })

  let tracks = store.document.tracks.values()
  let selectedTrackId = tracks[0]?.id ?? ''
  let selectedTrack: Track | undefined = tracks[0]
  let selectedProperties = buildPropertyRows(selectedTrack)
  let timelinePlacements = buildTimelinePlacements()
  let timelineLength = calculateTimelineLength(timelinePlacements)
  let draftName = selectedTrack?.name ?? ''
  let numberDrafts: Record<string, number> = {}
  let transportPlaying = app.editorTransport.playing
  let transportBpm = app.editorTransport.bpm
  let transportBeat = app.editorTransport.currentBeat
  let audioEngineStatus = 'idle'
  let midiStatus = 'idle'
  let preferencesStatus = 'not loaded'
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

  function buildTimelinePlacements(): TimelinePlacementView[] {
    const placements: TimelinePlacementView[] = []

    for (const track of store.document.tracks.values()) {
      for (const placement of track.placements) {
        const pattern = store.document.patterns.get(placement.target)

        placements.push({
          id: placement.id,
          trackId: track.id,
          trackName: track.name,
          patternId: pattern.id,
          patternName: pattern.name,
          start: placement.start,
          length: placement.length ?? pattern.length
        })
      }
    }

    return placements
  }

  function calculateTimelineLength(placements: TimelinePlacementView[]): BeatTime {
    const lastBeat = placements.reduce(
      (maximum, placement) =>
        Math.max(maximum, placement.start + placement.length),
      0
    )

    return Math.max(16, Math.ceil(lastBeat + 4))
  }

  function placementsForTrack(trackId: string): TimelinePlacementView[] {
    return timelinePlacements.filter((placement) => placement.trackId === trackId)
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
    timelinePlacements = buildTimelinePlacements()
    timelineLength = calculateTimelineLength(timelinePlacements)
    draftName = selectedTrack?.name ?? ''
    issues = validateDocument(store.document)
    canUndo = store.history.canUndo()
    canRedo = store.history.canRedo()
  }

  function handleServiceEvent(event: ServiceEvent) {
    if (event.type === 'transport:playing-changed') {
      const payload = event.payload as { playing?: boolean } | undefined
      transportPlaying = payload?.playing ?? false
    }

    if (event.type === 'transport:tempo-changed') {
      const payload = event.payload as { bpm?: number } | undefined
      transportBpm = payload?.bpm ?? transportBpm
    }

    if (event.type === 'transport:beat-changed') {
      const payload = event.payload as { currentBeat?: number } | undefined
      transportBeat = payload?.currentBeat ?? transportBeat
    }

    if (event.type === 'audio-engine:status-changed') {
      const payload = event.payload as { status?: string } | undefined
      audioEngineStatus = payload?.status ?? audioEngineStatus
    }

    if (event.type === 'audio-engine:playing-changed') {
      const payload = event.payload as { playing?: boolean } | undefined
      audioEngineStatus = payload?.playing ? 'playing' : 'idle'
    }

    if (event.type === 'midi:initialised') {
      midiStatus = 'idle'
    }

    if (event.type === 'midi:shutdown') {
      midiStatus = 'offline'
    }

    if (event.type === 'preferences:loaded') {
      preferencesStatus = 'loaded'
    }
  }

  function playTransport() {
    app.editorTransport.play()
  }

  function stopTransport() {
    app.editorTransport.stop()
  }

  function setRuntimeBpm(event: Event) {
    const bpm = readNumberValue(event)

    if (!Number.isFinite(bpm) || bpm <= 0) return

    app.editorTransport.setBpm(bpm)
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

  function movePlacement(placement: TimelinePlacementView, delta: BeatTime) {
    const nextStart = Math.max(0, placement.start + delta)

    if (nextStart === placement.start) return

    store.execute(
      new MovePatternPlacementOperation(
        placement.trackId,
        placement.id,
        nextStart
      )
    )
    syncView()
  }

  function resizePlacement(placement: TimelinePlacementView, delta: BeatTime) {
    const nextLength = Math.max(1, placement.length + delta)

    if (nextLength === placement.length) return

    store.execute(
      new ResizePatternPlacementOperation(
        placement.trackId,
        placement.id,
        nextLength
      )
    )
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

    <div class="transport-panel" aria-label="Runtime transport">
      <div class="transport-buttons">
        <button type="button" on:click={playTransport} disabled={transportPlaying}>
          Play
        </button>
        <button type="button" on:click={stopTransport} disabled={!transportPlaying}>
          Stop
        </button>
      </div>

      <label class="bpm-control" for="runtime-bpm">
        <span>BPM</span>
        <input
          id="runtime-bpm"
          type="number"
          min="1"
          step="1"
          value={transportBpm}
          on:change={setRuntimeBpm}
        />
      </label>

      <div class="beat-readout">
        <span>Beat</span>
        <strong>{transportBeat.toFixed(2)}</strong>
      </div>
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
      <section class="timeline-panel" aria-label="Timeline">
        <div class="pane-heading">
          <h2>Timeline</h2>
          <span>{timelineLength} beats</span>
        </div>

        <div class="beat-ruler" aria-hidden="true">
          <span>0</span>
          <span>{Math.floor(timelineLength / 2)}</span>
          <span>{timelineLength}</span>
        </div>

        <div class="timeline-rows">
          {#each tracks as track (track.id)}
            <div class="timeline-row">
              <div class="track-label">
                <strong>{track.name}</strong>
                <span>{placementsForTrack(track.id).length} placements</span>
              </div>

              <div class="track-lane">
                {#each placementsForTrack(track.id) as placement (placement.id)}
                  <div
                    class="placement"
                    style={`left: ${(placement.start / timelineLength) * 100}%; width: ${(placement.length / timelineLength) * 100}%;`}
                  >
                    <div class="placement-title">{placement.patternName}</div>
                    <div class="placement-meta">
                      {placement.start} / {placement.length}
                    </div>
                    <div class="placement-controls" aria-label={`${placement.patternName} placement controls`}>
                      <button
                        type="button"
                        aria-label={`Move ${placement.patternName} left`}
                        disabled={placement.start <= 0}
                        on:click={() => movePlacement(placement, -1)}
                      >
                        &lt;
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${placement.patternName} right`}
                        on:click={() => movePlacement(placement, 1)}
                      >
                        &gt;
                      </button>
                      <button
                        type="button"
                        aria-label={`Shorten ${placement.patternName}`}
                        disabled={placement.length <= 1}
                        on:click={() => resizePlacement(placement, -1)}
                      >
                        -
                      </button>
                      <button
                        type="button"
                        aria-label={`Lengthen ${placement.patternName}`}
                        on:click={() => resizePlacement(placement, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </section>

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

  <section class="runtime-status" aria-label="Runtime service status">
    <div>
      <span>Editor Transport</span>
      <strong>{transportPlaying ? 'playing' : 'stopped'}</strong>
    </div>
    <div>
      <span>Tempo</span>
      <strong>{transportBpm}</strong>
    </div>
    <div>
      <span>Beat</span>
      <strong>{transportBeat.toFixed(2)}</strong>
    </div>
    <div>
      <span>Audio Engine</span>
      <strong>{audioEngineStatus}</strong>
    </div>
    <div>
      <span>MIDI</span>
      <strong>{midiStatus}</strong>
    </div>
    <div>
      <span>Preferences</span>
      <strong>{preferencesStatus}</strong>
    </div>
  </section>

  <footer class="statusbar">
    <span>{store.document.patterns.values().length} patterns</span>
    <span>{store.document.parameterDefinitions.values().length} property types</span>
    <span>{store.document.parameters.values().length} properties</span>
    <span class:ok={issues.length === 0}>{issues.length} issues</span>
  </footer>
</main>
