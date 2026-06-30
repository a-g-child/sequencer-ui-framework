<script lang="ts">
  import type { EditorDefinition } from '../editor-types';
  import type { EditorKind } from '../editor-types';
  import type { PatternTool } from './pattern-tool';

  export let editors: EditorDefinition[] = [];
  export let activeEditor: EditorKind;

  export let tools: PatternTool[] = [];
  export let activeToolId: string;

  export let onEditorChange: (editor: EditorKind) => void;
  export let onToolChange: (tool: PatternTool) => void;

  export let onAddNote: (() => void) | undefined = undefined;
  export let onZoomIn: () => void;
  export let onZoomOut: () => void;
  export let onZoomPitchIn: (() => void) | undefined = undefined;
  export let onZoomPitchOut: (() => void) | undefined = undefined;
  export let onPanLeft: () => void;
  export let onPanRight: () => void;
  export let onPitchUp: () => void;
  export let onPitchDown: () => void;
  export let onResetView: () => void;
</script>

<div class="pattern-toolbar">
  <div class="toolbar-group">
    {#each editors as editor}
      <button
        class:active={activeEditor === editor.id}
        on:click={() => onEditorChange(editor.id)}
        title={editor.description}
      >
        {editor.name}
      </button>
    {/each}
  </div>

  <div class="toolbar-group">
    {#each tools as tool}
      <button
        class:active={activeToolId === tool.id}
        on:click={() => onToolChange(tool)}
      >
        {tool.name}
      </button>
    {/each}
  </div>

  <div class="toolbar-group">
    {#if onAddNote}
      <button type="button" on:click={onAddNote}>Add C4</button>
    {/if}
    <button type="button" on:click={onZoomOut}>X -</button>
    <button type="button" on:click={onZoomIn}>X +</button>
    {#if onZoomPitchOut && onZoomPitchIn}
      <button type="button" on:click={onZoomPitchOut}>Y -</button>
      <button type="button" on:click={onZoomPitchIn}>Y +</button>
    {/if}
    <button type="button" on:click={onPanLeft}>Left</button>
    <button type="button" on:click={onPanRight}>Right</button>
    <button type="button" on:click={onPitchUp}>Pitch +</button>
    <button type="button" on:click={onPitchDown}>Pitch -</button>
    <button type="button" on:click={onResetView}>Reset</button>
  </div>
</div>

<style>
  .pattern-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .toolbar-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  button {
    min-height: 34px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-weight: 700;
  }

  button.active {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
    font-weight: 700;
  }
</style>
