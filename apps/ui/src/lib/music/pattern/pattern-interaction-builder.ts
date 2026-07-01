import type { AppController } from '../../app-controller';
import type { PatternInputState } from './pattern-input-state';
import type {
  PatternInteractionContext
} from './pattern-tool';
import type { PatternViewport } from './pattern-viewport';
import type { GridDefinition } from './pattern-grid';
import type { PatternRenderer } from './pattern-renderer';
import type {
  PianoRollNoteView,
  PianoRollView
} from '../../editors/piano-roll/piano-roll-model';

export type BuildPatternInteractionContextOptions = {
  event: PointerEvent;
  element: HTMLElement;
  controller: AppController;
  input: PatternInputState;
  patternId: string;
  viewport: PatternViewport;
  grid: GridDefinition;
  pianoRoll: PianoRollView;
  renderer: PatternRenderer<PianoRollView>;
  selectedNotes: PianoRollView['notes'];
  hoveredNote?: PianoRollNoteView;
};

export function buildPatternInteractionContext(
  options: BuildPatternInteractionContextOptions
): PatternInteractionContext {
  const element = resolvePatternElement(options.element);
  const rect = element.getBoundingClientRect();

  const x = options.event.clientX - rect.left;
  const y = options.event.clientY - rect.top - element.clientTop;

  const musical = options.renderer.pointerToMusical(
    options.pianoRoll,
    options.viewport,
    options.grid,
    x,
    y
  );

  const hoveredNote =
    options.hoveredNote ??
    options.renderer.hitTest(
      options.pianoRoll,
      options.viewport,
      x,
      y
    );

  return {
    controller: options.controller,
    patternId: options.patternId,
    pointer: { x, y },
    musical,
    hoveredNote,
    selectedNotes: options.selectedNotes,
    visibleNotes: options.pianoRoll.notes,
    viewport: options.viewport,
    highestPitch: options.pianoRoll.highestPitch,
    modifiers: { ...options.input.modifiers }
  };
}

function resolvePatternElement(element: HTMLElement): HTMLElement {
  return element.classList.contains('piano-roll')
    ? element
    : element.closest<HTMLElement>('.piano-roll') ?? element;
}
