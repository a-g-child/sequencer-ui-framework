<script lang="ts">
  import type { PatternRenderModel } from './pattern-renderer';
  import {
    beatToScreenX,
    durationToScreenWidth
  } from './pattern-viewport';

  export let renderModel: PatternRenderModel;

  function laneY(pitch: number): number {
    return renderModel.lanes.find((lane) => lane.id === String(pitch))?.y ?? 0;
  }

  function laneHeight(pitch: number): number {
    return renderModel.lanes.find((lane) => lane.id === String(pitch))?.height ?? renderModel.noteHeight;
  }
</script>

{#if renderModel.ghost && renderModel.activeToolId === 'draw-note'}
  <div
    class="note-ghost"
    style={`left: ${beatToScreenX(renderModel.ghost.beat, renderModel.viewport)}px; top: ${laneY(renderModel.ghost.pitch) + 1}px; width: ${durationToScreenWidth(renderModel.grid.snap, renderModel.viewport)}px; height: ${Math.min(renderModel.noteHeight, laneHeight(renderModel.ghost.pitch))}px;`}
  ></div>
{/if}

{#each renderModel.overlayRectangles as overlay (overlay.id)}
  <div
    class="marquee-overlay"
    style={`left: ${overlay.x}px; top: ${overlay.y}px; width: ${overlay.width}px; height: ${overlay.height}px;`}
  ></div>
{/each}

{#each renderModel.overlayNotes as overlayNote (overlayNote.id)}
  <div
    class="note-overlay"
    class:ghost={overlayNote.variant === 'ghost'}
    style={`left: ${beatToScreenX(overlayNote.time, renderModel.viewport)}px; width: ${durationToScreenWidth(overlayNote.duration, renderModel.viewport)}px; height: ${Math.min(renderModel.noteHeight, laneHeight(overlayNote.pitch))}px; top: ${laneY(overlayNote.pitch) + 1}px;`}
  ></div>
{/each}
