import { DeleteNoteOperation } from '@sequencer/music';
import type { PatternInteractionContext, PatternTool } from '../pattern-tool';

export class EraseNoteTool implements PatternTool {
  readonly id = 'erase-note';
  readonly name = 'Erase';

  pointerDown(context: PatternInteractionContext): void {
    if (!context.hoveredNote) return;

    context.controller.execute(
      new DeleteNoteOperation(context.patternId, context.hoveredNote.id)
    );
  }
}
