import { DeleteNoteOperation } from '@sequencer/music';
import type { PatternInteractionContext, PatternTool } from '../pattern-tool.ts';

export class EraseNoteTool implements PatternTool {
  readonly id = 'erase-note';
  readonly name = 'Erase';

  pointerDown(context: PatternInteractionContext): void {
    const hoveredNote = context.hoveredItem?.source;

    if (!hoveredNote) return;

    context.controller.execute(
      new DeleteNoteOperation(context.patternId, hoveredNote.id)
    );
  }
}
