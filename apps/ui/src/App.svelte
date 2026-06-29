<script lang="ts">
  import { onMount } from 'svelte'
  import {
    SequencerApplication,
    validateDocument,
    type SelectionItem,
    type ServiceEvent,
    type Parameter,
    type ParameterDefinition,
    type ParameterValue,
    type Pattern,
    type Track
  } from '@sequencer/core'
  import { AppController } from './lib/app-controller'
  import {
    buildInspectorView,
    type InspectorView
  } from './lib/inspector/inspector-model'
  import {
    buildTimelineView,
    type TimelinePlacementView,
    type TimelineView
  } from './lib/timeline/timeline-model'
  import {
    buildPianoRollView,
    type PianoRollNoteView,
    type PianoRollView
  } from './lib/editors/piano-roll/piano-roll-model'

  const app = new SequencerApplication()
  const controller = new AppController(app)
  const store = app.documentStore
  controller.selectInitialTrack()

  onMount(() => {
    const unsubscribe = app.serviceEvents.subscribe(handleServiceEvent)
    void app.initialise()

    return () => {
      unsubscribe()
      void app.shutdown()
    }
  })

  let tracks = store.document.tracks.values()
  let selected: SelectionItem | undefined = store.selection.current()
  let selectedTrackId = selected?.type === 'track' ? selected.id : ''
  let inspector: InspectorView = buildInspectorView(store)
  let timeline: TimelineView = buildTimelineView(store)
  let activePattern: Pattern | undefined = store.document.patterns.values()[0]
  let pianoRoll: PianoRollView | undefined = activePattern
    ? buildPianoRollView(activePattern)
    : undefined
  let draftName = inspector.type === 'track' ? inspector.title : ''
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

  function rebuildInspector() {
    selected = store.selection.current()
    selectedTrackId = selected?.type === 'track' ? selected.id : ''
    inspector = buildInspectorView(store)
    draftName = inspector.type === 'track' ? inspector.title : ''
  }

  function syncView() {
    tracks = store.document.tracks.values()
    timeline = buildTimelineView(store)
    activePattern = activePattern
      ? store.document.patterns.find(activePattern.id)
      : store.document.patterns.values()[0]
    pianoRoll = activePattern ? buildPianoRollView(activePattern) : undefined
    rebuildInspector()
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
    controller.playTransport()
  }

  function stopTransport() {
    controller.stopTransport()
  }

  function setRuntimeBpm(event: Event) {
    const bpm = readNumberValue(event)

    controller.setRuntimeBpm(bpm)
  }

  function selectTrack(track: Track) {
    controller.selectTrack(track)
    rebuildInspector()
  }

  function selectPlacement(placement: TimelinePlacementView) {
    controller.selectPlacement(placement)
    rebuildInspector()
  }

  function selectNote(note: PianoRollNoteView) {
    controller.selectNote(note)
    rebuildInspector()
  }

  function addTrack() {
    controller.addTrack()
    syncView()
  }

  function renameSelectedTrack() {
    const nextName = draftName.trim()

    if (!controller.renameSelectedTrack(nextName)) {
      draftName = inspector.type === 'track' ? inspector.title : ''
      return
    }

    syncView()
  }

  function setParameterValue(parameterId: string, value: ParameterValue) {
    controller.setParameterValue(parameterId, value)
    syncView()
  }

  function movePlacement(placement: TimelinePlacementView, delta: number) {
    if (!controller.movePlacement(placement, delta)) return

    syncView()
  }

  function resizePlacement(placement: TimelinePlacementView, delta: number) {
    if (!controller.resizePlacement(placement, delta)) return

    syncView()
  }

  function setNumberPreview(parameterId: string, value: number) {
    numberDrafts = {
      ...numberDrafts,
      [parameterId]: value
    }
    inspector = {
      ...inspector,
      properties: inspector.properties.map((property) =>
        property.parameter.id === parameterId
          ? { ...property, value }
          : property
      )
    }
    controller.previewParameterValue(parameterId, value)
  }

  function commitNumberValue(parameterId: string, value: number) {
    numberDrafts = Object.fromEntries(
      Object.entries(numberDrafts).filter(([id]) => id !== parameterId)
    )

    controller.commitNumberValue(parameterId, value)
    syncView()
  }

  function commitPlacementStart(nextStart: number) {
    if (!controller.setPlacementStart(inspector.placement, nextStart)) return

    syncView()
  }

  function commitPlacementLength(nextLength: number) {
    if (!controller.setPlacementLength(inspector.placement, nextLength)) return

    syncView()
  }

  function commitPlacementLoopCount(nextLoopCount: number) {
    if (!controller.setPlacementLoopCount(inspector.placement, nextLoopCount)) {
      return
    }

    syncView()
  }

  function addC4Note() {
    if (!pianoRoll) return

    controller.createNote(pianoRoll.patternId, 0, 1, 60)
    syncView()
  }

  function commitNoteTime(nextTime: number) {
    if (!controller.setNoteTime(inspector.note, nextTime)) return

    syncView()
  }

  function commitNotePitch(nextPitch: number) {
    if (!controller.setNotePitch(inspector.note, nextPitch)) return

    syncView()
  }

  function commitNoteDuration(nextDuration: number) {
    if (!controller.setNoteDuration(inspector.note, nextDuration)) return

    syncView()
  }

  function deleteSelectedNote() {
    if (!controller.deleteNote(inspector.note)) return

    syncView()
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
    controller.undo()
    syncView()
  }

  function redo() {
    controller.redo()
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
          <span>{timeline.length} beats</span>
        </div>

        <div class="beat-ruler" aria-hidden="true">
          <span>Beat</span>
          <div class="timeline-ruler-track">
            {#each timeline.beatMarkers as marker}
              <span style={`left: ${marker.position}%`}>
                {marker.label}
              </span>
            {/each}
          </div>
        </div>

        <div class="timeline-rows">
          {#each timeline.tracks as track (track.id)}
            <div class="timeline-row">
              <div class="track-label">
                <strong>{track.name}</strong>
                <span>{track.placementCount} placements</span>
              </div>

              <div class="track-lane">
                <div class="track-lane-grid" aria-hidden="true">
                  {#each timeline.subdivisionLines as line}
                    <span
                      class:beat-line={line.isBeat}
                      style={`left: ${line.position}%`}
                    ></span>
                  {/each}
                </div>

                {#each track.placements as placement (placement.id)}
                  <div
                    class="placement"
                    style={`left: ${(placement.start / timeline.length) * 100}%; width: ${(placement.length / timeline.length) * 100}%;`}
                  >
                    <button
                      type="button"
                      class="placement-select"
                      class:selected={selected?.type === 'placement' && selected.id === placement.id}
                      on:click={() => selectPlacement(placement)}
                    >
                      <span class="placement-title">{placement.patternName}</span>
                      <span class="placement-meta">
                        {placement.start} / {placement.length}
                      </span>
                    </button>
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

      {#if pianoRoll}
        <section class="piano-roll-panel" aria-label="Piano roll">
          <div class="pane-heading">
            <h2>Piano Roll</h2>
            <span>{pianoRoll.patternName}</span>
          </div>

          <div class="piano-roll-toolbar">
            <button type="button" on:click={addC4Note}>Add C4</button>
          </div>

          <div
            class="piano-roll-frame"
          >
            <div class="piano-roll-ruler" aria-hidden="true">
              <span>Beat</span>
              <div class="piano-roll-ruler-track">
                {#each pianoRoll.beatMarkers as marker}
                  <span style={`left: ${marker.position}%`}>
                    {marker.label}
                  </span>
                {/each}
              </div>
            </div>

            <div class="piano-roll-body">
              <div
                class="pitch-ruler"
                style={`height: ${pianoRoll.pitchCount * 20}px;`}
                aria-hidden="true"
              >
                <span>{pianoRoll.highestPitch}</span>
                <span>{pianoRoll.lowestPitch}</span>
              </div>

              <div
                class="piano-roll"
                style={`height: ${pianoRoll.pitchCount * 20}px;`}
              >
                <div class="piano-roll-grid" aria-hidden="true">
                  {#each pianoRoll.subdivisionLines as line}
                    <span
                      class:beat-line={line.isBeat}
                      style={`left: ${line.position}%`}
                    ></span>
                  {/each}

                  {#each pianoRoll.pitchRows as pitch}
                    <span
                      class="pitch-line"
                      style={`top: ${(pianoRoll.highestPitch - pitch) * 20}px`}
                    ></span>
                  {/each}
                </div>

                {#each pianoRoll.notes as note (note.id)}
                  <button
                    type="button"
                    class="note"
                    class:selected={selected?.type === 'note' && selected.id === note.id}
                    style={`left: ${(note.time / pianoRoll.length) * 100}%; width: ${(note.duration / pianoRoll.length) * 100}%; top: ${(pianoRoll.highestPitch - note.pitch) * 20 + 1}px;`}
                    on:click={() => selectNote(note)}
                  >
                    {note.pitch}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </section>
      {/if}

      {#if inspector.type === 'track'}
        <div class="pane-heading">
          <h2>{inspector.title}</h2>
          <span>{selected?.type ?? 'track'}</span>
        </div>

        <form class="rename-form" on:submit|preventDefault={renameSelectedTrack}>
          <label for="track-name">Name</label>
          <div class="rename-row">
            <input id="track-name" bind:value={draftName} />
            <button type="submit">Rename</button>
          </div>
        </form>

        <div class="property-list">
          {#each inspector.properties as property (property.parameter.id)}
            <div class="property-row">
              <label for={`property-${property.parameter.id}`}>
                {property.definition.name}
              </label>

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
            </div>
          {/each}
        </div>
      {:else if inspector.type === 'placement' && inspector.placement}
        <div class="pane-heading">
          <h2>{inspector.title}</h2>
          <span>{inspector.placement.id}</span>
        </div>

        <div class="placement-inspector">
          <label>
            <span>Target Pattern</span>
            <input value={inspector.placement.targetPatternName} readonly />
          </label>

          <label>
            <span>Start</span>
            <input
              type="number"
              step="0.25"
              min="0"
              value={inspector.placement.start}
              on:change={(event) =>
                commitPlacementStart(readNumberValue(event))}
            />
          </label>

          <label>
            <span>Length</span>
            <input
              type="number"
              step="0.25"
              min="0.25"
              value={inspector.placement.length}
              on:change={(event) =>
                commitPlacementLength(readNumberValue(event))}
            />
          </label>

          <label>
            <span>Loop Count</span>
            <input
              type="number"
              step="1"
              min="1"
              value={inspector.placement.loopCount}
              on:change={(event) =>
                commitPlacementLoopCount(readNumberValue(event))}
            />
          </label>
        </div>
      {:else if inspector.type === 'note' && inspector.note}
        <div class="pane-heading">
          <h2>{inspector.title}</h2>
          <span>{inspector.note.id}</span>
        </div>

        <div class="placement-inspector">
          <label>
            <span>Pitch</span>
            <input
              type="number"
              step="1"
              min="0"
              max="127"
              value={inspector.note.pitch}
              on:change={(event) =>
                commitNotePitch(readNumberValue(event))}
            />
          </label>

          <label>
            <span>Start</span>
            <input
              type="number"
              step="0.25"
              min="0"
              value={inspector.note.time}
              on:change={(event) =>
                commitNoteTime(readNumberValue(event))}
            />
          </label>

          <label>
            <span>Length</span>
            <input
              type="number"
              step="0.25"
              min="0.25"
              value={inspector.note.duration}
              on:change={(event) =>
                commitNoteDuration(readNumberValue(event))}
            />
          </label>

          <label>
            <span>Velocity</span>
            <input value={inspector.note.velocity} readonly />
          </label>
        </div>

        <div class="inspector-actions">
          <button type="button" on:click={deleteSelectedNote}>Delete Note</button>
        </div>
      {:else}
        <div class="empty-state">
          <h2>No Selection</h2>
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
