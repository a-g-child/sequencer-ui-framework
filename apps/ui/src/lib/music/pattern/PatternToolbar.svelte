<script lang="ts">
  import type {
    PatternRendererDefinition,
    PatternRendererId
  } from './PatternEditorSession';
  import type { PatternTool } from './pattern-tool';

  export let renderers: PatternRendererDefinition[] = [];
  export let activeRendererId: PatternRendererId;

  export let tools: PatternTool[] = [];
  export let activeToolId: string;

  export let onRendererChange: (rendererId: PatternRendererId) => void;
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
  <div class="pattern-mode-selector" aria-label="Pattern renderer">
    {#each renderers as renderer}
      <button
        type="button"
        class:active={activeRendererId === renderer.id}
        title={renderer.description}
        aria-pressed={activeRendererId === renderer.id}
        on:click={() => onRendererChange(renderer.id)}
      >
        {renderer.name}
      </button>
    {/each}
  </div>

  <div class="pattern-tool-strip" aria-label="Pattern tools">
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
</div>

<style>
  .pattern-editor-chrome {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--spacing-md);
    flex-wrap: wrap;
  }

  .pattern-mode-selector,
  .pattern-tool-strip {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    flex-wrap: wrap;
  }

  .pattern-mode-selector button,
  .pattern-tool-strip button {
    min-height: var(--control-height-md);
    border-radius: var(--radius-md);
    color: var(--muted);
    background: var(--surface-2);
    font-weight: 700;
  }

  .pattern-mode-selector button {
    padding: 0 var(--spacing-md);
  }

  .pattern-tool-strip button {
    width: var(--control-height-md);
    padding: 0;
    display: inline-grid;
    place-items: center;
    font-size: var(--font-size-lg);
  }

  .pattern-mode-selector button:hover,
  .pattern-tool-strip button:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .pattern-mode-selector button.active,
  .pattern-tool-strip button.active {
    border-color: var(--accent-strong);
    background: var(--accent-soft);
    color: var(--text);
    box-shadow:
      inset 0 0 0 var(--border-width) var(--accent-strong),
      0 0 0 var(--border-width) color-mix(in srgb, var(--accent-strong) 22%, transparent);
  }
</style>
