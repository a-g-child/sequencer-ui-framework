import type { AppController } from '../../app-controller';
import type { PianoRollNoteView } from '../../editors/piano-roll/piano-roll-model';
import {
  panViewportX,
  panViewportY,
  type PatternNavigationBounds,
  zoomViewportX
} from './pattern-navigation';
import type { PatternViewport } from './pattern-viewport';

export type PatternShortcutContext = {
  controller: AppController;
  viewport: PatternViewport;
  navigationBounds: PatternNavigationBounds;
  patternId?: string;
  selectedNotes: PianoRollNoteView[];
  pasteTargetBeat: number;
  applyViewport: (viewport: PatternViewport) => void;
  resetViewport: () => void;
  syncView: () => void;
};

export function handlePatternShortcut(
  event: KeyboardEvent,
  context: PatternShortcutContext
): boolean {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
    context.controller.copyNotes(context.selectedNotes);
    return true;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
    if (context.patternId) {
      context.controller.pasteNotes(context.patternId, {
        beat: context.pasteTargetBeat
      });
      context.syncView();
    }
    return true;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
    if (context.patternId) {
      context.controller.duplicateNotes(
        context.patternId,
        context.selectedNotes
      );
      context.syncView();
    }
    return true;
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    context.controller.deleteSelectedNotes();
    context.syncView();
    return true;
  }

  if (event.key === 'Home') {
    context.resetViewport();
    return true;
  }

  if (event.key === '+' || event.key === '=') {
    context.applyViewport(
      zoomViewportX(context.viewport, 1.1, context.navigationBounds)
    );
    return true;
  }

  if (event.key === '-' || event.key === '_') {
    context.applyViewport(
      zoomViewportX(context.viewport, 0.9, context.navigationBounds)
    );
    return true;
  }

  if (event.key === 'ArrowLeft') {
    context.applyViewport(
      panViewportX(context.viewport, -0.25, context.navigationBounds)
    );
    return true;
  }

  if (event.key === 'ArrowRight') {
    context.applyViewport(
      panViewportX(context.viewport, 0.25, context.navigationBounds)
    );
    return true;
  }

  if (event.key === 'ArrowUp') {
    context.applyViewport(
      panViewportY(context.viewport, -1, context.navigationBounds)
    );
    return true;
  }

  if (event.key === 'ArrowDown') {
    context.applyViewport(
      panViewportY(context.viewport, 1, context.navigationBounds)
    );
    return true;
  }

  return false;
}
