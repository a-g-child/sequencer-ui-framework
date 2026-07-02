<script lang="ts">
  import type { PatternRenderModel } from './pattern-renderer';
  import {
    beatToScreenX,
    patternLengthToScreenWidth
  } from './pattern-viewport';

  export let renderModel: PatternRenderModel;
  export let layer: 'ruler' | 'pitch-ruler' | 'background';

  $: renderHeight = Math.max(
    0,
    ...renderModel.lanes.map((lane) => lane.y + lane.height)
  );
</script>

{#if layer === 'ruler'}
  <div class="piano-roll-ruler" aria-hidden="true">
    <span>{renderModel.rendererId === 'drum-rack' ? 'Lane' : 'Note'}</span>
    <div
      class="piano-roll-ruler-track"
      style={`width: ${patternLengthToScreenWidth(renderModel.visibleLength, renderModel.viewport)}px;`}
    >
      {#each renderModel.gridLines as marker}
        <span
          class="ruler-marker"
          class:beat-marker={marker.isBeat}
          class:bar-marker={marker.isBar}
          style={`left: ${beatToScreenX(marker.beat, renderModel.viewport)}px`}
        >
          {marker.label}
        </span>
      {/each}
    </div>
  </div>
{:else if layer === 'pitch-ruler'}
  <div
    class="pitch-ruler"
    style={`height: ${renderHeight}px;`}
    aria-hidden="true"
  >
    {#each renderModel.lanes as lane}
      <span
        style={`top: ${lane.y + lane.height / 2}px`}
      >
        {lane.label}
      </span>
    {/each}
  </div>
{:else}
  <div class="piano-roll-grid" aria-hidden="true">
    {#each renderModel.gridLines as line}
      <span
        class:beat-line={line.isBeat}
        class:bar-line={line.isBar}
        style={`left: ${beatToScreenX(line.beat, renderModel.viewport)}px`}
      ></span>
    {/each}

    {#each renderModel.lanes as lane}
      <span
        class="pitch-line"
        style={`top: ${lane.y}px`}
      ></span>
    {/each}
  </div>
{/if}
