import type { PianoRollView } from '../../editors/piano-roll/piano-roll-model';
import type { RenderModelBuilder } from '../../framework/editor';
import {
  buildPatternGridLines
} from './pattern-grid';
import type { PatternEditorSession } from './PatternEditorSession';
import type {
  PatternRenderer,
  PatternRenderModel
} from './pattern-renderer';

export type PatternRenderModelBuilderInput = {
  document: PianoRollView;
  session: PatternEditorSession;
  renderer: PatternRenderer<PianoRollView>;
};

export class PatternRenderModelBuilder
  implements
    RenderModelBuilder<
      PatternRenderModelBuilderInput,
      PatternRenderModel
    >
{
  build(input: PatternRenderModelBuilderInput): PatternRenderModel {
    const { document, session, renderer } = input;
    const visibleLength = session.visibleLength(document);

    return renderer.render({
      viewModel: document,
      viewport: session.viewport,
      grid: session.grid,
      visibleLength,
      gridLines: buildPatternGridLines(visibleLength, session.grid),
      selectedNotes: session.selectedNotes(document),
      hoveredNoteId: session.hoveredNoteId,
      activeToolId: session.activeTool.id,
      isPanning: session.isPanning,
      noteHeight: session.noteHeight(),
      ghost: session.showGhost
        ? { beat: session.ghostBeat, pitch: session.ghostPitch }
        : undefined,
      overlayNotes: session.overlayNotes(),
      overlayRectangles: session.overlayRectangles()
    });
  }
}
