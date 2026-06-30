import type { AppController } from '../../app-controller';
import type { PatternInputState } from './pattern-input-state';
import type {
  PatternInteractionContext
} from './pattern-tool';
import type { PatternViewport } from './pattern-viewport';
import type { GridDefinition } from './pattern-grid';
import { screenXToBeat, screenYToPitch, snapBeat } from './pattern-viewport';
import { hitTestNote } from './pattern-hit-testing';
import type {
  PianoRollNoteView,
  PianoRollView
} from '../piano-roll/piano-roll-model';

export type BuildPatternInteractionContextOptions = {
  event: PointerEvent;
  element: HTMLElement;
  controller: AppController;
  input: PatternInputState;
  patternId: string;
  viewport: PatternViewport;
  grid: GridDefinition;
  pianoRoll: PianoRollView;
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

  const beatRaw = screenXToBeat(x, options.viewport);
  const beat = snapBeat(beatRaw, options.grid.snap);
  const pitch = clampPitch(
    screenYToPitch(y, options.viewport, options.pianoRoll.highestPitch),
    options.pianoRoll.lowestPitch,
    options.pianoRoll.highestPitch
  );

  const hoveredNote =
    options.hoveredNote ??
    hitTestNote(
      options.pianoRoll.notes,
      options.viewport,
      options.pianoRoll.highestPitch,
      x,
      y
    );

  return {
    controller: options.controller,
    patternId: options.patternId,
    pointer: { x, y },
    musical: { beat, pitch, snap: options.grid.snap },
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

function clampPitch(pitch: number, lowestPitch: number, highestPitch: number) {
  return Math.max(lowestPitch, Math.min(highestPitch, pitch));
}
