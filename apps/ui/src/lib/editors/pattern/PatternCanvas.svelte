<script lang="ts">
  import type { PianoRollNoteView } from '../piano-roll/piano-roll-model';
  import type { PatternRenderModel } from './pattern-renderer';
  import {
    beatToScreenX,
    durationToScreenWidth,
    patternLengthToScreenWidth,
    pitchRangeToScreenHeight,
    pitchToScreenY
  } from './pattern-viewport';

  export let renderModel: PatternRenderModel;
  export let onWheel: (event: WheelEvent) => void;
  export let onPointerEnter: (event: PointerEvent) => void;
  export let onPointerDown: (event: PointerEvent) => void;
  export let onPointerMove: (event: PointerEvent) => void;
  export let onPointerUp: (event: PointerEvent) => void;
  export let onPointerLeave: (event: PointerEvent) => void;
  export let onNotePointerDown: (
    event: PointerEvent,
    note: PianoRollNoteView
  ) => void;
  export let onNotePointerMove: (
    event: PointerEvent,
    note: PianoRollNoteView
  ) => void;
  export let onNotePointerUp: (
    event: PointerEvent,
    note: PianoRollNoteView
  ) => void;

  const middleCPitch = 60;

  let scrollElement: HTMLDivElement | undefined;

  export function centerOnMiddleC() {
    if (!scrollElement) return;

    const middleCOffset =
      pitchToScreenY(middleCPitch, renderModel.viewport, 127) -
      scrollElement.clientHeight / 2;

    scrollElement.scrollTop = Math.max(0, middleCOffset);
  }

  function centerOnMount(node: HTMLDivElement) {
    scrollElement = node;
    centerOnMiddleC();
  }

  function noteName(pitch: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(pitch / 12) - 1;

    return `${names[pitch % 12]}${octave}`;
  }
</script>

<div
  class="piano-roll-frame"
>
  <div
    class="piano-roll-scroll"
    bind:this={scrollElement}
    use:centerOnMount
    on:wheel={onWheel}
  >
    <div class="piano-roll-content">
      <div class="piano-roll-ruler" aria-hidden="true">
        <span>Note</span>
        <div
          class="piano-roll-ruler-track"
          style={`width: ${patternLengthToScreenWidth(renderModel.visibleLength, renderModel.viewport)}px;`}
        >
          {#each renderModel.gridLines.filter((line) => line.label) as marker}
            <span style={`left: ${beatToScreenX(marker.beat, renderModel.viewport)}px`}>
              {marker.label}
            </span>
          {/each}
        </div>
      </div>

      <div class="piano-roll-body">
        <div
          class="pitch-ruler"
          style={`height: ${pitchRangeToScreenHeight(renderModel.pitchCount, renderModel.viewport)}px;`}
          aria-hidden="true"
        >
          {#each renderModel.pitchRows as pitch}
            <span
              class:c-note={pitch % 12 === 0}
              style={`top: ${pitchToScreenY(pitch, renderModel.viewport, renderModel.highestPitch) + renderModel.viewport.pixelsPerSemitone / 2}px`}
            >
              {noteName(pitch)}
            </span>
          {/each}
        </div>

        <div
          class="piano-roll"
          class:panning={renderModel.isPanning}
          role="application"
          aria-label="Piano roll notes"
          style={`width: ${patternLengthToScreenWidth(renderModel.visibleLength, renderModel.viewport)}px; height: ${pitchRangeToScreenHeight(renderModel.pitchCount, renderModel.viewport)}px;`}
          on:pointerenter={onPointerEnter}
          on:pointerdown={onPointerDown}
          on:pointermove={onPointerMove}
          on:pointerup={onPointerUp}
          on:pointerleave={onPointerLeave}
          on:auxclick|preventDefault
        >
          <div class="piano-roll-grid" aria-hidden="true">
            {#each renderModel.gridLines as line}
              <span
                class:beat-line={line.isMajor}
                style={`left: ${beatToScreenX(line.beat, renderModel.viewport)}px`}
              ></span>
            {/each}

            {#each renderModel.pitchRows as pitch}
              <span
                class="pitch-line"
                style={`top: ${pitchToScreenY(pitch, renderModel.viewport, renderModel.highestPitch)}px`}
              ></span>
            {/each}
          </div>

          {#if renderModel.ghost && renderModel.activeToolId === 'draw-note'}
            <div
              class="note-ghost"
              style={`left: ${beatToScreenX(renderModel.ghost.beat, renderModel.viewport)}px; top: ${pitchToScreenY(renderModel.ghost.pitch, renderModel.viewport, renderModel.highestPitch) + 1}px; width: ${durationToScreenWidth(renderModel.grid.snap, renderModel.viewport)}px; height: ${renderModel.noteHeight}px;`}
            ></div>
          {/if}

          {#each renderModel.overlayRectangles as overlay (overlay.id)}
            <div
              class="marquee-overlay"
              style={`left: ${overlay.x}px; top: ${overlay.y}px; width: ${overlay.width}px; height: ${overlay.height}px;`}
            ></div>
          {/each}

          {#each renderModel.notes as note (note.id)}
            <button
              type="button"
              class="note"
              class:selected={renderModel.selectedNoteIds.includes(note.id)}
              class:hovered={renderModel.hoveredNoteId === note.id}
              class:resize-active={renderModel.activeToolId === 'resize-note'}
              aria-label={`${noteName(note.pitch)} note at beat ${note.time}`}
              style={`left: ${beatToScreenX(note.time, renderModel.viewport)}px; width: ${durationToScreenWidth(note.duration, renderModel.viewport)}px; height: ${renderModel.noteHeight}px; top: ${pitchToScreenY(note.pitch, renderModel.viewport, renderModel.highestPitch) + 1}px;`}
              on:pointerdown|stopPropagation={(event) =>
                onNotePointerDown(event, note)}
              on:pointermove|stopPropagation={(event) =>
                onNotePointerMove(event, note)}
              on:pointerup|stopPropagation={(event) =>
                onNotePointerUp(event, note)}
              on:auxclick|preventDefault
            >
              {#if renderModel.activeToolId === 'resize-note'}
                <span
                  class="note-resize-handle"
                  aria-label={`Resize ${noteName(note.pitch)} note`}
                  role="presentation"
                ></span>
              {/if}
            </button>
          {/each}

          {#each renderModel.overlayNotes as overlayNote (overlayNote.id)}
            <div
              class="note-overlay"
              class:ghost={overlayNote.variant === 'ghost'}
              style={`left: ${beatToScreenX(overlayNote.time, renderModel.viewport)}px; width: ${durationToScreenWidth(overlayNote.duration, renderModel.viewport)}px; height: ${renderModel.noteHeight}px; top: ${pitchToScreenY(overlayNote.pitch, renderModel.viewport, renderModel.highestPitch) + 1}px;`}
            ></div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
