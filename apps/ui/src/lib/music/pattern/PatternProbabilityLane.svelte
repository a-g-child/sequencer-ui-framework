<script lang="ts">
  import type { PianoRollNoteView } from '../../editors/piano-roll/piano-roll-model';
  import type { PatternRenderModel } from './pattern-renderer';
  import { patternLengthToScreenWidth } from './pattern-viewport';

  export let renderModel: PatternRenderModel;
  export let onProbabilityCommit: (
    note: PianoRollNoteView,
    probability: number
  ) => void;

  const laneHeight = 64;
  let laneElement: HTMLDivElement | undefined;
  let activeItemId = '';
  let draftProbabilities: Record<string, number> = {};

  $: laneWidth = patternLengthToScreenWidth(
    renderModel.visibleLength,
    renderModel.viewport
  );

  function displayProbability(note: PianoRollNoteView): number {
    return draftProbabilities[note.id] ?? note.probability;
  }

  function beginProbabilityDrag(
    event: PointerEvent,
    note: PianoRollNoteView
  ): void {
    activeItemId = note.id;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    updateProbabilityDraft(event, note);
  }

  function moveProbabilityDrag(
    event: PointerEvent,
    note: PianoRollNoteView
  ): void {
    if (activeItemId !== note.id) return;

    updateProbabilityDraft(event, note);
  }

  function endProbabilityDrag(
    event: PointerEvent,
    note: PianoRollNoteView
  ): void {
    if (activeItemId !== note.id) return;

    updateProbabilityDraft(event, note);
    const nextProbability = displayProbability(note);

    activeItemId = '';
    draftProbabilities = Object.fromEntries(
      Object.entries(draftProbabilities).filter(([id]) => id !== note.id)
    );

    if (nextProbability !== note.probability) {
      onProbabilityCommit(note, nextProbability);
    }
  }

  function updateProbabilityDraft(
    event: PointerEvent,
    note: PianoRollNoteView
  ): void {
    draftProbabilities = {
      ...draftProbabilities,
      [note.id]: readProbability(event)
    };
  }

  function readProbability(event: PointerEvent): number {
    if (!laneElement) return 0;

    const bounds = laneElement.getBoundingClientRect();
    const offsetY = event.clientY - bounds.top;
    const probability = 1 - offsetY / Math.max(1, bounds.height);

    return Math.min(1, Math.max(0, probability));
  }
</script>

<div class="velocity-lane probability-lane" aria-label="Note probabilities">
  <span>Prob</span>

  <div
    class="velocity-lane-track"
    bind:this={laneElement}
    style={`width: ${laneWidth}px; height: ${laneHeight}px;`}
  >
    {#each renderModel.items as item (item.id)}
      {@const probability = displayProbability(item.source)}
      <button
        type="button"
        class="velocity-bar probability-bar"
        class:selected={item.selected}
        class:active={activeItemId === item.id}
        aria-label={`Probability ${Math.round(probability * 100)}%`}
        title={`Probability ${Math.round(probability * 100)}%`}
        style={`left: ${item.x}px; width: ${Math.max(6, item.width)}px; height: ${Math.max(3, probability * laneHeight)}px;`}
        on:pointerdown|preventDefault|stopPropagation={(event) =>
          beginProbabilityDrag(event, item.source)}
        on:pointermove|preventDefault|stopPropagation={(event) =>
          moveProbabilityDrag(event, item.source)}
        on:pointerup|preventDefault|stopPropagation={(event) =>
          endProbabilityDrag(event, item.source)}
        on:pointercancel|preventDefault|stopPropagation={(event) =>
          endProbabilityDrag(event, item.source)}
      ></button>
    {/each}
  </div>
</div>
