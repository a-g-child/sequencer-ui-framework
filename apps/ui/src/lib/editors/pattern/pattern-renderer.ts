import type { PatternInteractionContext, PatternOverlay } from './pattern-tool';
import type { PatternViewport } from './pattern-viewport';
import type { GridDefinition } from './pattern-grid';

export interface PatternRenderer<TViewModel> {
  readonly id: string;
  readonly name: string;

  render(
    viewModel: TViewModel,
    viewport: PatternViewport,
    grid: GridDefinition,
    interaction?: PatternInteractionContext,
    overlay?: PatternOverlay[]
  ): void;
}
