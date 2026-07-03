import type { AppController } from '../../app-controller';
import type { PatternInputState } from './pattern-input-state';
import type {
  PatternInteractionContext
} from './pattern-tool';
import type { RenderInteractionItem } from '../../framework/editor';
import { hitTestRenderItem } from './pattern-hit-testing';
import type { PatternViewport } from './pattern-viewport';
import type { GridDefinition } from './pattern-grid';
import type {
  PatternRenderer,
  PatternRenderModel
} from './pattern-renderer';
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
  renderModel: PatternRenderModel;
  hoveredItem?: RenderInteractionItem<PianoRollNoteView>;
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
    y,
    options.renderModel
  );

  const hoveredItem = options.hoveredItem ?? hitTestRenderItem<PianoRollNoteView>(
    options.renderModel.items,
    x,
    y
  );

  return {
    controller: options.controller,
    patternId: options.patternId,
    pointer: { x, y },
    musical,
    pitchByVisualPitch: options.renderModel.pitchByVisualPitch,
    hoveredItem,
    selectedItems: options.renderModel.items.filter((item) => item.selected),
    visibleItems: options.renderModel.items,
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
