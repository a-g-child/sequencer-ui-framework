import type { PatternInteractionContext, PatternTool } from '../pattern-tool';

export class SelectTool implements PatternTool {
  readonly id = 'select';
  readonly name = 'Select';

  pointerDown(context: PatternInteractionContext): void {
    if (!context.hoveredNote) return;

    context.controller.selectNoteById(context.patternId, context.hoveredNote.id);
  }
}
