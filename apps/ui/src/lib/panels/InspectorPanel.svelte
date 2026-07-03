<script lang="ts">
  import type {
    Parameter,
    ParameterDefinition,
    ParameterValue
  } from '@sequencer/core';
  import type { InspectorView } from '../inspector/inspector-model';

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
              value={property.value}
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
        {:else if property.definition.kind === 'boolean' && typeof property.value === 'boolean'}
          <input
            id={`property-${property.parameter.id}`}
            class="checkbox-property"
            type="checkbox"
            checked={property.value}
            on:change={(event) =>
              onSetParameterValue(
                property.parameter.id,
                readBooleanValue(event)
              )}
          />
        {:else if property.definition.kind === 'choice'}
          <select
            id={`property-${property.parameter.id}`}
            value={String(property.value)}
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
        {:else if property.definition.kind === 'text' && typeof property.value === 'string'}
          <input
            id={`property-${property.parameter.id}`}
            value={property.value}
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

  .placement-inspector {
    display: grid;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
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
    .number-property {
      grid-template-columns: 1fr;
    }

    .property-row strong {
      justify-self: start;
    }
  }
</style>
