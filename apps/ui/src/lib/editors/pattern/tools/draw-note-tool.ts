import { CreateNoteOperation } from '@sequencer/music';
import type {
  PatternInteractionContext,
  PatternOverlay,
  PatternTool
} from '../pattern-tool';

export class DrawNoteTool implements PatternTool {
  readonly id = 'draw-note';
  readonly name = 'Draw Note';

  pointerDown(context: PatternInteractionContext): void {
    context.controller.execute(
      new CreateNoteOperation(
        context.patternId,
        context.musical.beat,
        context.musical.snap,
        context.musical.pitch
      )
    );
  }

  drawOverlay(context: PatternInteractionContext): PatternOverlay {
    return {
      notes: [
        {
          id: 'draw-preview',
          time: context.musical.beat,
          duration: context.musical.snap,
          pitch: context.musical.pitch,
          variant: 'preview'
        }
      ]
    };
  }
}
