<script lang="ts">
  import type { PianoRollNoteView } from '../../editors/piano-roll/piano-roll-model';
  import type { PatternRenderModel } from './pattern-renderer';
  import { patternLengthToScreenWidth } from './pattern-viewport';

  export let renderModel: PatternRenderModel;
  export let onVelocityCommit: (
    note: PianoRollNoteView,
    velocity: number
  ) => void;

  const laneHeight = 64;
  let laneElement: HTMLDivElement | undefined;
  let activeItemId = '';
  let draftVelocities: Record<string, number> = {};

  $: laneWidth = patternLengthToScreenWidth(
    renderModel.visibleLength,
    renderModel.viewport
  );

  function displayVelocity(note: PianoRollNoteView): number {
    return draftVelocities[note.id] ?? note.velocity;
  }

  function beginVelocityDrag(
    event: PointerEvent,
    note: PianoRollNoteView
  ): void {
    activeItemId = note.id;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    updateVelocityDraft(event, note);
  }

  function moveVelocityDrag(
    event: PointerEvent,
    note: PianoRollNoteView
  ): void {
    if (activeItemId !== note.id) return;

    updateVelocityDraft(event, note);
  }

  function endVelocityDrag(
    event: PointerEvent,
    note: PianoRollNoteView
  ): void {
    if (activeItemId !== note.id) return;

    updateVelocityDraft(event, note);
    const nextVelocity = displayVelocity(note);

    activeItemId = '';
    draftVelocities = Object.fromEntries(
      Object.entries(draftVelocities).filter(([id]) => id !== note.id)
    );

    if (nextVelocity !== note.velocity) {
      onVelocityCommit(note, nextVelocity);
    }
  }

  function updateVelocityDraft(
    event: PointerEvent,
    note: PianoRollNoteView
  ): void {
    draftVelocities = {
      ...draftVelocities,
      [note.id]: readVelocity(event)
    };
  }

  function readVelocity(event: PointerEvent): number {
    if (!laneElement) return 0;

    const bounds = laneElement.getBoundingClientRect();
    const offsetY = event.clientY - bounds.top;
    const velocity = 1 - offsetY / Math.max(1, bounds.height);

    return Math.min(1, Math.max(0, velocity));
  }
</script>

<div class="velocity-lane" aria-label="Note velocities">
  <span>Vel</span>

  <div
    class="velocity-lane-track"
    bind:this={laneElement}
    style={`width: ${laneWidth}px; height: ${laneHeight}px;`}
  >
    {#each renderModel.items as item (item.id)}
      {@const velocity = displayVelocity(item.source)}
      <button
        type="button"
        class="velocity-bar"
        class:selected={item.selected}
        class:active={activeItemId === item.id}
        aria-label={`Velocity ${Math.round(velocity * 100)}%`}
        title={`Velocity ${Math.round(velocity * 100)}%`}
        style={`left: ${item.x}px; width: ${Math.max(6, item.width)}px; height: ${Math.max(3, velocity * laneHeight)}px;`}
        on:pointerdown|preventDefault|stopPropagation={(event) =>
          beginVelocityDrag(event, item.source)}
        on:pointermove|preventDefault|stopPropagation={(event) =>
          moveVelocityDrag(event, item.source)}
        on:pointerup|preventDefault|stopPropagation={(event) =>
          endVelocityDrag(event, item.source)}
        on:pointercancel|preventDefault|stopPropagation={(event) =>
          endVelocityDrag(event, item.source)}
      ></button>
    {/each}
  </div>
</div>
