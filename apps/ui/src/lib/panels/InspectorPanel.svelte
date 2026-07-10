<script lang="ts">
  import type {
    Parameter,
    ParameterDefinition,
    ParameterValue
  } from '@sequencer/core';
  import type { InspectorView } from '../inspector/inspector-model';
  import {
    scaleDefinitions,
    scaleRoots,
    type PatternScaleMode
  } from '../music/pattern/pattern-scale';

  export let inspector: InspectorView;
  export let selectedType = 'track';
  export let draftName = '';
  export let onRenameTrack: () => void;
  export let onSetNumberPreview: (parameterId: string, value: number) => void;
  export let onCommitNumberValue: (parameterId: string, value: number) => void;
  export let onSetParameterValue: (
    parameterId: string,
    value: ParameterValue
  ) => void;
  export let onCommitPlacementStart: (value: number) => void;
  export let onCommitPlacementLength: (value: number) => void;
  export let onCommitPlacementLoopCount: (value: number) => void;
  export let onCommitNotePitch: (value: number) => void;
  export let onCommitNoteTime: (value: number) => void;
  export let onCommitNoteDuration: (value: number) => void;
  export let onDeleteSelectedNote: () => void;
  export let onSetTrackMute: (trackId: string, value: boolean) => void = () => {};
  export let onSetTrackSolo: (trackId: string, value: boolean) => void = () => {};
  export let onSetTrackVolume: (trackId: string, value: number) => void = () => {};
  export let onSetTrackPan: (trackId: string, value: number) => void = () => {};
  export let onStopTrack: (trackId: string) => void = () => {};
  export let onArmClip: () => void = () => {};
  export let onSetClipLoop: (value: boolean) => void = () => {};
  export let onSetClipEnd: (value: number) => void = () => {};
  export let onSetClipLoopStart: (value: number) => void = () => {};
  export let onSetClipLoopEnd: (value: number) => void = () => {};
  export let onSetBeatDivisions: (value: number) => void = () => {};
  export let onQuantizeClipSelection: () => void = () => {};
  export let onHumanizeClipSelection: () => void = () => {};
  export let onToggleVelocityLane: () => void = () => {};
  export let onToggleProbabilityLane: () => void = () => {};
  export let onToggleAutomationLane: () => void = () => {};
  export let onScaleRootChange: (root: number) => void = () => {};
  export let onScaleIdChange: (scaleId: string) => void = () => {};
  export let onScaleModeChange: (mode: PatternScaleMode) => void = () => {};

  type TrackDialKey = 'volume' | 'pan';

  const beatDivisionOptions = [
    { value: 1, label: '1/4' },
    { value: 2, label: '1/8' },
    { value: 4, label: '1/16' },
    { value: 8, label: '1/32' },
    { value: 16, label: '1/64' },
    { value: 32, label: '1/128' }
  ];

  let trackDialDrag:
    | {
        pointerId: number;
        trackId: string;
        key: TrackDialKey;
        startY: number;
        startValue: number;
        min: number;
        max: number;
      }
    | undefined;

  function readNumberValue(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value);
  }

  function readBooleanValue(event: Event): boolean {
    return (event.currentTarget as HTMLInputElement).checked;
  }

  function readTextValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value;
  }

  function readChoiceValue(
    event: Event,
    definition: ParameterDefinition | undefined
  ): ParameterValue {
    const value = (event.currentTarget as HTMLSelectElement).value;
    const option = definition?.options?.find(
      (item) => String(item.value) === value
    );

    return option?.value ?? value;
  }

  function formatParameterValue(parameter: Parameter): string {
    if (typeof parameter.value === 'boolean') {
      return parameter.value ? 'On' : 'Off';
    }

    return String(parameter.value);
  }

  function formatOptionalMetric(value: number | undefined, unit = 'ms'): string {
    return value === undefined ? '-' : `${value.toFixed(2)}${unit}`;
  }

  function dialPercent(value: number, min: number, max: number): number {
    if (!Number.isFinite(value) || max <= min) return 0;

    return Math.min(1, Math.max(0, (value - min) / (max - min)));
  }

  function dialStyle(
    value: number,
    min: number,
    max: number,
    mode: TrackDialKey
  ): string {
    const percent = dialPercent(value, min, max);
    const dialDegrees = Number((percent * 270).toFixed(3));
    const fillStart = mode === 'pan' ? Math.min(135, dialDegrees) : 0;
    const fillEnd = mode === 'pan' ? Math.max(135, dialDegrees) : dialDegrees;

    return [
      `--dial-value: ${percent}`,
      `--dial-fill-start: ${fillStart}deg`,
      `--dial-fill-end: ${fillEnd}deg`
    ].join(';');
  }

  function panLabel(value: number): string {
    if (Math.abs(value) < 0.005) return 'C';

    return `${value < 0 ? 'L' : 'R'}${Math.round(Math.abs(value) * 100)}`;
  }

  function beginTrackDialDrag(
    event: PointerEvent,
    trackId: string,
    key: TrackDialKey,
    value: number,
    min: number,
    max: number
  ): void {
    const target = event.currentTarget as HTMLElement;

    trackDialDrag = {
      pointerId: event.pointerId,
      trackId,
      key,
      startY: event.clientY,
      startValue: value,
      min,
      max
    };
    target.setPointerCapture(event.pointerId);
  }

  function dragTrackDial(event: PointerEvent): void {
    if (!trackDialDrag || trackDialDrag.pointerId !== event.pointerId) return;

    const target = event.currentTarget as HTMLElement;

    if (!target.hasPointerCapture(event.pointerId)) return;

    const range = trackDialDrag.max - trackDialDrag.min;
    const dragDistance = event.shiftKey ? 1000 : 200;
    const valueDelta = ((trackDialDrag.startY - event.clientY) / dragDistance) *
      range;

    setTrackDialValue(
      trackDialDrag.trackId,
      trackDialDrag.key,
      trackDialDrag.startValue + valueDelta,
      trackDialDrag.min,
      trackDialDrag.max
    );
  }

  function endTrackDialDrag(event: PointerEvent): void {
    if (!trackDialDrag || trackDialDrag.pointerId !== event.pointerId) return;

    const target = event.currentTarget as HTMLElement;

    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    trackDialDrag = undefined;
  }

  function handleTrackDialKeydown(
    event: KeyboardEvent,
    trackId: string,
    key: TrackDialKey,
    value: number,
    min: number,
    max: number
  ): void {
    const increment = event.shiftKey ? 0.001 : 0.01;

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      setTrackDialValue(trackId, key, value + increment, min, max);
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setTrackDialValue(trackId, key, value - increment, min, max);
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setTrackDialValue(trackId, key, min, min, max);
    }

    if (event.key === 'End') {
      event.preventDefault();
      setTrackDialValue(trackId, key, max, min, max);
    }
  }

  function handleTrackDialWheel(
    event: WheelEvent,
    trackId: string,
    key: TrackDialKey,
    value: number,
    min: number,
    max: number
  ): void {
    event.preventDefault();
    setTrackDialValue(
      trackId,
      key,
      value + (event.deltaY < 0 ? 0.01 : -0.01),
      min,
      max
    );
  }

  function setTrackDialValue(
    trackId: string,
    key: TrackDialKey,
    value: number,
    min: number,
    max: number
  ): void {
    if (!trackId || !Number.isFinite(value)) return;

    const clampedValue = Math.min(max, Math.max(min, value));
    const steppedValue = min + Math.round((clampedValue - min) / 0.01) * 0.01;
    const finalValue = Number(Math.min(max, Math.max(min, steppedValue)).toFixed(6));

    if (key === 'volume') {
      onSetTrackVolume(trackId, finalValue);
      return;
    }

    onSetTrackPan(trackId, finalValue);
  }

</script>

{#if inspector.type === 'track'}
  <div class="pane-heading">
    <h2>{inspector.title}</h2>
    <span>{selectedType}</span>
  </div>

  <form class="rename-form" on:submit|preventDefault={onRenameTrack}>
    <label for="track-name">Name</label>
    <div class="rename-row">
      <input id="track-name" bind:value={draftName} />
      <button type="submit">Rename</button>
    </div>
  </form>

  <div class="property-list">
    {#each inspector.properties as property (property.parameter.id)}
      {@const value = property.value}
      <div class="property-row">
        <label for={`property-${property.parameter.id}`}>
          {property.definition.name}
        </label>

        {#if property.definition.kind === 'number' && typeof value === 'number'}
          <div class="number-property">
            <input
              id={`property-${property.parameter.id}`}
              type="range"
              min={property.definition.min}
              max={property.definition.max}
              step={property.definition.step}
              value={value}
              on:input={(event) =>
                onSetNumberPreview(
                  property.parameter.id,
                  readNumberValue(event)
                )}
              on:change={(event) =>
                onCommitNumberValue(
                  property.parameter.id,
                  readNumberValue(event)
                )}
            />
            <input
              aria-label={`${property.definition.name} value`}
              type="number"
              min={property.definition.min}
              max={property.definition.max}
              step={property.definition.step}
              value={value}
              on:input={(event) =>
                onSetNumberPreview(
                  property.parameter.id,
                  readNumberValue(event)
                )}
              on:change={(event) =>
                onCommitNumberValue(
                  property.parameter.id,
                  readNumberValue(event)
                )}
            />
          </div>
        {:else if property.definition.kind === 'boolean' && typeof value === 'boolean'}
          <input
            id={`property-${property.parameter.id}`}
            class="checkbox-property"
            type="checkbox"
            checked={value}
            on:change={(event) =>
              onSetParameterValue(
                property.parameter.id,
                readBooleanValue(event)
              )}
          />
        {:else if property.definition.kind === 'choice'}
          <select
            id={`property-${property.parameter.id}`}
            value={String(value)}
            on:change={(event) =>
              onSetParameterValue(
                property.parameter.id,
                readChoiceValue(event, property.definition)
              )}
          >
            {#each property.definition.options ?? [] as option}
              <option value={String(option.value)}>{option.label}</option>
            {/each}
          </select>
        {:else if property.definition.kind === 'text' && typeof value === 'string'}
          <input
            id={`property-${property.parameter.id}`}
            value={value}
            on:input={(event) =>
              onSetParameterValue(
                property.parameter.id,
                readTextValue(event)
              )}
          />
        {:else}
          <strong>{formatParameterValue(property.parameter)}</strong>
        {/if}
      </div>
    {/each}
  </div>

  {#if inspector.graph}
    <section class="graph-diagnostics" aria-label="Device graph diagnostics">
      <div class="graph-heading">
        <h3>Graph</h3>
        <span>{inspector.graph.deviceName}</span>
      </div>

      <div class="graph-summary">
        <div>
          <span>Nodes</span>
          <strong>{inspector.graph.nodeCount}</strong>
        </div>
        <div>
          <span>Connections</span>
          <strong>{inspector.graph.connectionCount}</strong>
        </div>
        <div>
          <span>Latency</span>
          <strong>{inspector.graph.latencySamples} samples</strong>
        </div>
        <div>
          <span>Warnings</span>
          <strong>{inspector.graph.validationMessages.length}</strong>
        </div>
      </div>

      <div class="graph-row">
        <span>Preset</span>
        <strong>{inspector.graph.presetId}</strong>
      </div>

      <div class="graph-order">
        <span>Execution Order</span>
        <ol>
          {#each inspector.graph.executionOrder as nodeId}
            <li>{nodeId}</li>
          {/each}
        </ol>
      </div>

      <div class="graph-node-diagnostics">
        <span>Node Diagnostics</span>
        <div class="node-diagnostics-table">
          <div class="node-diagnostics-header">
            <span>#</span>
            <span>Node</span>
            <span>Last</span>
            <span>Avg</span>
            <span>Peak</span>
            <span>Latency</span>
          </div>
          {#each inspector.graph.nodeDiagnostics as diagnostic}
            <div class="node-diagnostics-row">
              <strong>{diagnostic.executionIndex}</strong>
              <span>{diagnostic.nodeId}</span>
              <span>{formatOptionalMetric(diagnostic.lastProcessMs)}</span>
              <span>{formatOptionalMetric(diagnostic.averageProcessMs)}</span>
              <span>{formatOptionalMetric(diagnostic.peakProcessMs)}</span>
              <span>{diagnostic.latencySamples ?? 0} samples</span>
            </div>
          {/each}
        </div>
      </div>

      {#if inspector.graph.validationMessages.length > 0}
        <div class="graph-messages">
          <span>Validation</span>
          {#each inspector.graph.validationMessages as message}
            <p>
              <strong>{message.severity}</strong>
              {message.code}: {message.message}
            </p>
          {/each}
        </div>
      {:else}
        <div class="graph-row">
          <span>Validation</span>
          <strong>Clean</strong>
        </div>
      {/if}
    </section>
  {/if}
{:else if inspector.type === 'clip' && inspector.clip}
  <div class="pane-heading">
    <h2>{inspector.title}</h2>
    <span>{inspector.clip.trackName}</span>
  </div>

  <section class="inspector-section" aria-label="Track and clip controls">
    <div class="inspector-section-heading">
      <h3>Track</h3>
      <span>{inspector.clip.armed ? 'armed' : inspector.clip.pending ? 'queued' : 'idle'}</span>
    </div>

    <div class="clip-action-grid track-action-grid">
      <button
        type="button"
        class:active={inspector.clip.muted}
        aria-pressed={inspector.clip.muted}
        on:click={() =>
          onSetTrackMute(inspector.clip?.trackId ?? '', !(inspector.clip?.muted ?? false))}
      >
        Mute
      </button>
      <button
        type="button"
        class:active={inspector.clip.soloed}
        aria-pressed={inspector.clip.soloed}
        on:click={() =>
          onSetTrackSolo(inspector.clip?.trackId ?? '', !(inspector.clip?.soloed ?? false))}
      >
        Solo
      </button>
      <button
        type="button"
        on:click={() => onStopTrack(inspector.clip?.trackId ?? '')}
      >
        Stop
      </button>
      <button
        type="button"
        class:active={inspector.clip.armed || inspector.clip.pending}
        aria-pressed={inspector.clip.armed || inspector.clip.pending}
        on:click={onArmClip}
      >
        Arm Clip
      </button>
    </div>

    <div class="track-mixer-grid">
      <div
        class="track-dial volume-dial"
        style={dialStyle(inspector.clip.volume, 0, 1, 'volume')}
        title={`Volume ${Math.round(inspector.clip.volume * 100)}%`}
      >
        <span>Vol</span>
        <button
          type="button"
          class="track-dial-button"
          role="slider"
          aria-label={`${inspector.clip.trackName} volume`}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={inspector.clip.volume}
          on:pointerdown={(event) =>
            beginTrackDialDrag(
              event,
              inspector.clip?.trackId ?? '',
              'volume',
              inspector.clip?.volume ?? 0,
              0,
              1
            )}
          on:pointermove={dragTrackDial}
          on:pointerup={endTrackDialDrag}
          on:pointercancel={endTrackDialDrag}
          on:keydown={(event) =>
            handleTrackDialKeydown(
              event,
              inspector.clip?.trackId ?? '',
              'volume',
              inspector.clip?.volume ?? 0,
              0,
              1
            )}
          on:wheel={(event) =>
            handleTrackDialWheel(
              event,
              inspector.clip?.trackId ?? '',
              'volume',
              inspector.clip?.volume ?? 0,
              0,
              1
            )}
        >
          <span class="track-dial-face" aria-hidden="true">
            <span></span>
          </span>
        </button>
      </div>

      <div
        class="track-dial pan-dial"
        style={dialStyle(inspector.clip.pan, -1, 1, 'pan')}
        title={`Pan ${panLabel(inspector.clip.pan)}`}
      >
        <span>Pan</span>
        <button
          type="button"
          class="track-dial-button"
          role="slider"
          aria-label={`${inspector.clip.trackName} pan`}
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={inspector.clip.pan}
          on:pointerdown={(event) =>
            beginTrackDialDrag(
              event,
              inspector.clip?.trackId ?? '',
              'pan',
              inspector.clip?.pan ?? 0,
              -1,
              1
            )}
          on:pointermove={dragTrackDial}
          on:pointerup={endTrackDialDrag}
          on:pointercancel={endTrackDialDrag}
          on:keydown={(event) =>
            handleTrackDialKeydown(
              event,
              inspector.clip?.trackId ?? '',
              'pan',
              inspector.clip?.pan ?? 0,
              -1,
              1
            )}
          on:wheel={(event) =>
            handleTrackDialWheel(
              event,
              inspector.clip?.trackId ?? '',
              'pan',
              inspector.clip?.pan ?? 0,
              -1,
              1
            )}
        >
          <span class="track-dial-face" aria-hidden="true">
            <span></span>
          </span>
        </button>
      </div>
    </div>
  </section>

  <section class="inspector-section" aria-label="Clip parameters">
    <div class="inspector-section-heading">
      <h3>Clip</h3>
      <span>{inspector.clip.selectedNoteCount} selected</span>
    </div>

    <div class="placement-inspector clip-settings-grid">
      <label>
        <span>Start</span>
        <input type="number" step="0.25" value={inspector.clip.clipStart} readonly />
      </label>

      <label>
        <span>End</span>
        <input
          type="number"
          step="0.25"
          min={inspector.clip.clipStart + 0.25}
          value={inspector.clip.clipEnd}
          on:change={(event) => onSetClipEnd(readNumberValue(event))}
        />
      </label>

      <label>
        <span>Loop</span>
        <input
          class="checkbox-property"
          type="checkbox"
          checked={inspector.clip.loopEnabled}
          on:change={(event) => onSetClipLoop(readBooleanValue(event))}
        />
      </label>

      <label>
        <span>Loop Start</span>
        <input
          type="number"
          step="0.25"
          min="0"
          max={Math.max(0, inspector.clip.loopEnd - 0.25)}
          value={inspector.clip.loopStart}
          on:change={(event) => onSetClipLoopStart(readNumberValue(event))}
        />
      </label>

      <label>
        <span>Loop End</span>
        <input
          type="number"
          step="0.25"
          min={inspector.clip.loopStart + 0.25}
          max={inspector.clip.clipEnd}
          value={inspector.clip.loopEnd}
          on:change={(event) => onSetClipLoopEnd(readNumberValue(event))}
        />
      </label>

      <label>
        <span>Divisions</span>
        <select
          value={inspector.clip.beatDivisions}
          aria-label="Beat divisions"
          on:change={(event) =>
            onSetBeatDivisions(Number((event.currentTarget as HTMLSelectElement).value))}
        >
          {#each beatDivisionOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>

      <label class="clip-setting-wide">
        <span>Launch Quantise</span>
        <input value={inspector.clip.launchQuantizeLabel} readonly />
      </label>
    </div>

    {#if inspector.clip.scale}
      <div class="scale-settings-grid" aria-label="Scale controls">
        <label>
          <span>Root</span>
          <select
            value={inspector.clip.scale.root}
            on:change={(event) =>
              onScaleRootChange(Number((event.currentTarget as HTMLSelectElement).value))}
          >
            {#each scaleRoots as root}
              <option value={root.value}>{root.name}</option>
            {/each}
          </select>
        </label>

        <label>
          <span>Scale</span>
          <select
            value={inspector.clip.scale.scaleId}
            on:change={(event) =>
              onScaleIdChange((event.currentTarget as HTMLSelectElement).value)}
          >
            {#each scaleDefinitions as definition}
              <option value={definition.id}>{definition.name}</option>
            {/each}
          </select>
        </label>

        <div class="scale-mode-grid" aria-label="Scale display mode">
          <button
            type="button"
            class:active={inspector.clip.scale.mode === 'off'}
            aria-pressed={inspector.clip.scale.mode === 'off'}
            on:click={() => onScaleModeChange('off')}
          >
            All
          </button>
          <button
            type="button"
            class:active={inspector.clip.scale.mode === 'highlight'}
            aria-pressed={inspector.clip.scale.mode === 'highlight'}
            on:click={() => onScaleModeChange('highlight')}
          >
            HL
          </button>
          <button
            type="button"
            class:active={inspector.clip.scale.mode === 'fold'}
            aria-pressed={inspector.clip.scale.mode === 'fold'}
            on:click={() => onScaleModeChange('fold')}
          >
            Fold
          </button>
        </div>
      </div>
    {/if}

    <div class="clip-action-grid">
      <button
        type="button"
        disabled={inspector.clip.selectedNoteCount === 0}
        on:click={onQuantizeClipSelection}
      >
        Quantise
      </button>
      <button
        type="button"
        disabled={inspector.clip.selectedNoteCount === 0}
        on:click={onHumanizeClipSelection}
      >
        Humanise
      </button>
      <button
        type="button"
        class:active={inspector.clip.velocityLaneVisible}
        aria-pressed={inspector.clip.velocityLaneVisible}
        on:click={onToggleVelocityLane}
      >
        Velocity
      </button>
      <button
        type="button"
        class:active={inspector.clip.probabilityLaneVisible}
        aria-pressed={inspector.clip.probabilityLaneVisible}
        on:click={onToggleProbabilityLane}
      >
        Probability
      </button>
      <button
        type="button"
        class:active={inspector.clip.automationLaneVisible}
        aria-pressed={inspector.clip.automationLaneVisible}
        disabled={inspector.clip.automationTargetCount === 0}
        on:click={onToggleAutomationLane}
      >
        Automations
      </button>
    </div>
  </section>
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
          onCommitPlacementStart(readNumberValue(event))}
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
          onCommitPlacementLength(readNumberValue(event))}
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
          onCommitPlacementLoopCount(readNumberValue(event))}
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
        on:change={(event) => onCommitNotePitch(readNumberValue(event))}
      />
    </label>

    <label>
      <span>Start</span>
      <input
        type="number"
        step="0.25"
        min="0"
        value={inspector.note.time}
        on:change={(event) => onCommitNoteTime(readNumberValue(event))}
      />
    </label>

    <label>
      <span>Length</span>
      <input
        type="number"
        step="0.25"
        min="0.25"
        value={inspector.note.duration}
        on:change={(event) => onCommitNoteDuration(readNumberValue(event))}
      />
    </label>

    <label>
      <span>Velocity</span>
      <input value={inspector.note.velocity} readonly />
    </label>

    <label>
      <span>Probability</span>
      <input value={inspector.note.probability} readonly />
    </label>

    <label>
      <span>Humanise</span>
      <input value={inspector.note.humanizeOffset} readonly />
    </label>
  </div>

  <div class="inspector-actions">
    <button type="button" on:click={onDeleteSelectedNote}>Delete Note</button>
  </div>
{:else}
  <div class="empty-state">
    <h2>No Selection</h2>
  </div>
{/if}

<style>
  .inspector-actions button {
    min-height: var(--control-height-md);
    padding: 0 var(--spacing-md);
    border-radius: var(--radius-md);
    font-weight: 700;
  }

  .rename-form {
    display: grid;
    gap: var(--spacing-sm);
  }

  .rename-form label,
  .placement-inspector span {
    color: var(--muted);
    font-size: var(--font-size-md);
    font-weight: 700;
  }

  .rename-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--spacing-sm);
  }

  .rename-row button {
    min-height: var(--control-height-lg);
    padding: 0 var(--spacing-control-lg);
    border-color: transparent;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--text-primary);
    font-weight: 650;
  }

  .property-list {
    display: grid;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .property-row {
    min-height: var(--property-row-min-height);
    padding: var(--spacing-compact) var(--spacing-md);
    display: grid;
    grid-template-columns: minmax(var(--property-label-min-width), var(--property-label-max-width)) minmax(0, 1fr);
    align-items: center;
    gap: var(--spacing-lg);
    border-bottom: var(--border-width) solid var(--border);
  }

  .property-row:last-child {
    border-bottom: 0;
  }

  .property-row label {
    color: var(--muted);
    font-size: var(--font-size-md);
    font-weight: 700;
  }

  .property-row strong {
    overflow-wrap: anywhere;
    justify-self: end;
  }

  .graph-diagnostics {
    display: grid;
    gap: var(--spacing-sm);
    padding: var(--spacing-md);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .graph-heading {
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--spacing-sm);
  }

  .graph-heading h3 {
    margin: 0;
    font-size: var(--font-size-lg);
  }

  .graph-heading span,
  .graph-summary span,
  .graph-row span,
  .graph-order > span,
  .graph-messages > span {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .graph-summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--spacing-xs);
  }

  .graph-summary div {
    min-width: 0;
    padding: var(--spacing-xs);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    display: grid;
    gap: var(--spacing-2xs);
  }

  .graph-summary strong,
  .graph-row strong {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .graph-row,
  .graph-order,
  .graph-node-diagnostics,
  .graph-messages {
    min-width: 0;
    display: grid;
    gap: var(--spacing-xs);
  }

  .node-diagnostics-table {
    min-width: 0;
    display: grid;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    overflow: hidden;
    background: var(--surface);
  }

  .node-diagnostics-header,
  .node-diagnostics-row {
    min-width: 0;
    display: grid;
    grid-template-columns: 2.5rem minmax(7rem, 1fr) repeat(4, minmax(4.5rem, auto));
    gap: var(--spacing-xs);
    align-items: center;
    padding: var(--spacing-xs);
    border-bottom: var(--border-width) solid var(--border);
  }

  .node-diagnostics-header {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .node-diagnostics-row:last-child {
    border-bottom: 0;
  }

  .node-diagnostics-row span,
  .node-diagnostics-row strong {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .graph-order ol {
    margin: 0;
    padding-left: var(--spacing-lg);
  }

  .graph-order li {
    padding: var(--spacing-2xs) 0;
    overflow-wrap: anywhere;
  }

  .graph-messages p {
    margin: 0;
    padding: var(--spacing-xs);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    overflow-wrap: anywhere;
  }

  .number-property {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--number-input-width);
    align-items: center;
    gap: var(--spacing-compact);
  }

  .number-property input[type="range"] {
    padding: 0;
    accent-color: var(--accent);
  }

  .checkbox-property {
    width: var(--checkbox-size);
    min-height: var(--checkbox-size);
    justify-self: start;
    accent-color: var(--accent);
  }

  .inspector-section {
    min-width: 0;
    max-width: 100%;
    display: grid;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface-2);
    overflow: hidden;
    box-sizing: border-box;
  }

  .inspector-section-heading {
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--spacing-sm);
  }

  .inspector-section-heading h3 {
    margin: 0;
    font-size: var(--font-size-sm);
  }

  .inspector-section-heading span {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 800;
    text-transform: uppercase;
  }

  .clip-action-grid {
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }

  .track-action-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .clip-action-grid button {
    min-width: 0;
    min-height: 28px;
    padding: 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: 9px;
    font-weight: 800;
  }

  .clip-action-grid button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .clip-action-grid button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .clip-action-grid button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .track-mixer-grid {
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 40px));
    justify-content: start;
    gap: var(--spacing-xs);
  }

  .track-dial {
    min-width: 0;
    display: grid;
    justify-items: center;
    gap: 3px;
  }

  .track-dial > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .track-dial-button {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: ns-resize;
    touch-action: none;
  }

  .track-dial-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .track-dial-face {
    position: relative;
    display: block;
    width: 24px;
    height: 24px;
    margin: 3px;
    border: var(--border-width) solid var(--border-strong);
    border-radius: 50%;
    background:
      radial-gradient(circle at center, var(--surface-2) 0 44%, transparent 46%),
      conic-gradient(
        from -135deg,
        transparent 0deg var(--dial-fill-start),
        var(--accent) var(--dial-fill-start) var(--dial-fill-end),
        transparent var(--dial-fill-end) 270deg,
        transparent 270deg 360deg
      ),
      conic-gradient(
        from -135deg,
        color-mix(in srgb, var(--border) 76%, transparent) 0deg 270deg,
        transparent 270deg 360deg
      );
  }

  .track-dial-face > span {
    position: absolute;
    z-index: 2;
    top: 3px;
    left: 50%;
    width: 2px;
    height: 7px;
    border-radius: 2px;
    background: var(--accent);
    transform-origin: 50% 9px;
    transform:
      translateX(-50%)
      rotate(calc((var(--dial-value) * 270deg) - 135deg));
  }

  .track-dial-face::after {
    content: '';
    position: absolute;
    z-index: 1;
    top: 3px;
    left: 50%;
    width: 1px;
    height: 5px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--text) 68%, transparent);
    transform: translateX(-50%) rotate(var(--dial-origin, -135deg));
    transform-origin: 50% 9px;
  }

  .volume-dial {
    --dial-origin: -135deg;
  }

  .pan-dial {
    --dial-origin: 0deg;
  }

  .placement-inspector {
    display: grid;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    font-size: xx-small;
  }

  .inspector-section,
  .placement-inspector,
  .clip-action-grid,
  .track-mixer-grid,
  .track-dial,
  .clip-settings-grid,
  .scale-settings-grid,
  .scale-mode-grid,
  .clip-settings-grid label {
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }

  .inspector-section input,
  .inspector-section button {
    max-width: 100%;
    box-sizing: border-box;
  }

  .clip-settings-grid {
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 3px;
    padding: 3px;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    overflow: hidden;
  }

  .clip-settings-grid label {
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    display: grid;
    grid-template-columns: 1fr;
    align-content: start;
    gap: 2px;
  }

  .clip-settings-grid label:last-child {
    border-bottom: 0;
  }

  .clip-settings-grid .clip-setting-wide {
    grid-column: 1 / -1;
  }

  .clip-settings-grid span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 8px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .clip-settings-grid input,
  .clip-settings-grid select {
    min-width: 0;
    width: 100%;
    max-width: 100%;
    height: 18px;
    box-sizing: border-box;
    padding: 0 3px;
    font-size: 8px;
  }

  .clip-settings-grid select {
    border-radius: var(--radius-control);
    background: var(--surface);
    font-weight: 700;
  }

  .clip-settings-grid input[type='number'] {
    min-inline-size: 0;
    inline-size: 100%;
  }

  .clip-settings-grid .checkbox-property {
    width: 16px;
    height: 16px;
    min-height: 16px;
    justify-self: start;
    padding: 0;
  }

  .scale-settings-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.25fr);
    gap: 3px;
    padding: 3px;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
  }

  .scale-settings-grid label {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .scale-settings-grid span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 8px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .scale-settings-grid select {
    min-width: 0;
    width: 100%;
    height: 20px;
    padding: 0 3px;
    border-radius: var(--radius-control);
    background: var(--surface);
    font-size: 9px;
    font-weight: 700;
  }

  .scale-mode-grid {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 3px;
  }

  .scale-mode-grid button {
    min-width: 0;
    min-height: 20px;
    padding: 0 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--radius-control);
    color: var(--muted);
    font-size: 9px;
    font-weight: 800;
  }

  .scale-mode-grid button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .scale-mode-grid button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .placement-inspector label {
    min-height: var(--inspector-row-min-height);
    padding: var(--spacing-compact) var(--spacing-md);
    display: grid;
    grid-template-columns: minmax(var(--inspector-label-min-width), var(--inspector-label-max-width)) minmax(0, 1fr);
    align-items: center;
    gap: var(--spacing-lg);
    border-bottom: var(--border-width) solid var(--border);
  }

  .placement-inspector label:last-child {
    border-bottom: 0;
  }

  .placement-inspector input[readonly] {
    color: var(--muted);
    background: var(--surface-2);
  }

  .clip-settings-grid label {
    min-height: 0;
    padding: 0;
    border: 0;
    grid-template-columns: 1fr;
    align-content: start;
    align-items: stretch;
    gap: 2px;
  }

  .clip-settings-grid .clip-setting-wide {
    grid-column: 1 / -1;
  }

  .inspector-actions {
    display: flex;
    justify-content: flex-start;
  }

  .inspector-actions button {
    border-color: transparent;
    background: var(--danger);
    color: var(--text-primary);
  }

  .empty-state {
    min-height: var(--empty-state-min-height);
    display: grid;
    place-items: center;
    color: var(--muted);
  }

  @media (max-width: 760px) {
    .rename-row,
    .property-row,
    .placement-inspector label,
    .number-property,
    .graph-summary {
      grid-template-columns: 1fr;
    }

    .node-diagnostics-header,
    .node-diagnostics-row {
      grid-template-columns: 2rem minmax(0, 1fr);
    }

    .node-diagnostics-header span:nth-child(n + 3),
    .node-diagnostics-row span:nth-child(n + 3) {
      display: none;
    }

    .property-row strong {
      justify-self: start;
    }
  }
</style>
