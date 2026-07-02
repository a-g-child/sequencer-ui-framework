<script lang="ts">
  import type { EditorDefinition } from '../../editors/editor-types';
  import type { EditorKind } from '../../editors/editor-types';
  import type { PatternTool } from './pattern-tool';

  export let editors: EditorDefinition[] = [];
  export let activeEditor: EditorKind;

  export let tools: PatternTool[] = [];
  export let activeToolId: string;

  export let onEditorChange: (editor: EditorKind) => void;
  export let onToolChange: (tool: PatternTool) => void;

  const toolIcons: Record<string, string> = {
    select: '↖',
    'draw-note': '✎',
    'erase-note': '⌫',
    'move-note': '✥',
    'resize-note': '↔'
  };

  function toolIcon(tool: PatternTool): string {
    return toolIcons[tool.id] ?? tool.name.slice(0, 1);
  }
</script>

<div class="pattern-editor-chrome">
  <div class="pattern-mode-selector" aria-label="Editor mode">
    {#each editors as editor}
      <button
        type="button"
        class:active={activeEditor === editor.id}
        title={editor.description}
        aria-pressed={activeEditor === editor.id}
        on:click={() => onEditorChange(editor.id)}
      >
        {editor.name}
      </button>
    {/each}
  </div>

  {#if activeEditor === 'piano-roll'}
    <div class="pattern-tool-strip" aria-label="Piano roll tools">
      {#each tools as tool}
        <button
          type="button"
          class:active={activeToolId === tool.id}
          title={tool.name}
          aria-label={tool.name}
          aria-pressed={activeToolId === tool.id}
          on:click={() => onToolChange(tool)}
        >
          {toolIcon(tool)}
        </button>
      {/each}
    </div>
  {/if}
</div>
