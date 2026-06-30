<script lang="ts">
  import type { PatternRenderModel } from './pattern-renderer';
  import {
    beatToScreenX,
    patternLengthToScreenWidth,
    pitchRangeToScreenHeight,
    pitchToScreenY
  } from './pattern-viewport';

  export let renderModel: PatternRenderModel;
  export let layer: 'ruler' | 'pitch-ruler' | 'background';

  function noteName(pitch: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(pitch / 12) - 1;

    return `${names[pitch % 12]}${octave}`;
  }
</script>

{#if layer === 'ruler'}
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
{:else if layer === 'pitch-ruler'}
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
{:else}
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
{/if}
