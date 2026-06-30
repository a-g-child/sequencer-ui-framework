<script lang="ts">
  import type { PatternRenderModel } from './pattern-renderer';
  import {
    beatToScreenX,
    durationToScreenWidth,
    pitchToScreenY
  } from './pattern-viewport';

  export let renderModel: PatternRenderModel;
</script>

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

{#each renderModel.overlayNotes as overlayNote (overlayNote.id)}
  <div
    class="note-overlay"
    class:ghost={overlayNote.variant === 'ghost'}
    style={`left: ${beatToScreenX(overlayNote.time, renderModel.viewport)}px; width: ${durationToScreenWidth(overlayNote.duration, renderModel.viewport)}px; height: ${renderModel.noteHeight}px; top: ${pitchToScreenY(overlayNote.pitch, renderModel.viewport, renderModel.highestPitch) + 1}px;`}
  ></div>
{/each}
