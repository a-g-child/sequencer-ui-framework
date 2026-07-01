<script lang="ts">
  import Button from '../../framework/ui/Button.svelte';
  import Toolbar from '../../framework/ui/Toolbar.svelte';
  import ToolbarGroup from '../../framework/ui/ToolbarGroup.svelte';
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

<Toolbar>
  <ToolbarGroup>
    {#each editors as editor}
      <Button
        active={activeEditor === editor.id}
        on:click={() => onEditorChange(editor.id)}
        title={editor.description}
      >
        {editor.name}
      </Button>
    {/each}
  </ToolbarGroup>

  <ToolbarGroup>
    {#each tools as tool}
      <Button
        active={activeToolId === tool.id}
        on:click={() => onToolChange(tool)}
      >
        {tool.name}
      </Button>
    {/each}
  </ToolbarGroup>

  <ToolbarGroup>
    {#if onAddNote}
      <Button on:click={onAddNote}>Add C4</Button>
    {/if}
    <Button on:click={onZoomOut}>X -</Button>
    <Button on:click={onZoomIn}>X +</Button>
    {#if onZoomPitchOut && onZoomPitchIn}
      <Button on:click={onZoomPitchOut}>Y -</Button>
      <Button on:click={onZoomPitchIn}>Y +</Button>
    {/if}
    <Button on:click={onPanLeft}>Left</Button>
    <Button on:click={onPanRight}>Right</Button>
    <Button on:click={onPitchUp}>Pitch +</Button>
    <Button on:click={onPitchDown}>Pitch -</Button>
    <Button on:click={onResetView}>Reset</Button>
  </ToolbarGroup>
</Toolbar>
