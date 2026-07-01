import type { BeatTime } from '@sequencer/core';
import type { PianoRollNoteView, PianoRollView } from '../../editors/piano-roll/piano-roll-model';
import type { RenderModel } from '../../framework/editor';
import type { GridDefinition, PatternGridLine } from './pattern-grid';
import { hitTestNote } from './pattern-hit-testing';
import type { PatternNoteOverlay, PatternRectangleOverlay } from './pattern-tool';
import {
  screenXToBeat,
  screenYToPitch,
  snapBeat,
  type PatternViewport
} from './pattern-viewport';

export type PatternGhostView = {
  beat: number;
  pitch: number;
};

export type PatternMusicalPoint = {
  beat: BeatTime;
  pitch: number;
  snap: BeatTime;
};

export type PatternRenderModel = RenderModel & {
  rendererId: string;
  patternName: string;
  viewport: PatternViewport;
  grid: GridDefinition;
  visibleLength: number;
  pitchRows: number[];
  pitchCount: number;
  highestPitch: number;
  gridLines: PatternGridLine[];
  notes: PianoRollNoteView[];
  selectedNoteIds: string[];
  hoveredNoteId?: string;
  activeToolId: string;
  isPanning: boolean;
  noteHeight: number;
  ghost?: PatternGhostView;
  overlayNotes: PatternNoteOverlay[];
  overlayRectangles: PatternRectangleOverlay[];
};

export type PatternRenderInput<TViewModel> = {
  viewModel: TViewModel;
  viewport: PatternViewport;
  grid: GridDefinition;
  visibleLength: number;
  gridLines: PatternGridLine[];
  selectedNotes: PianoRollNoteView[];
  hoveredNoteId?: string;
  activeToolId: string;
  isPanning: boolean;
  noteHeight: number;
  ghost?: PatternGhostView;
  overlayNotes: PatternNoteOverlay[];
  overlayRectangles: PatternRectangleOverlay[];
};

export interface PatternRenderer<TViewModel> {
  readonly id: string;

  render(input: PatternRenderInput<TViewModel>): PatternRenderModel;
  hitTest(
    viewModel: TViewModel,
    viewport: PatternViewport,
    x: number,
    y: number
  ): PianoRollNoteView | undefined;
  pointerToMusical(
    viewModel: TViewModel,
    viewport: PatternViewport,
    grid: GridDefinition,
    x: number,
    y: number
  ): PatternMusicalPoint;
}

export class PianoRollRenderer implements PatternRenderer<PianoRollView> {
  readonly id = 'piano-roll';

  render(input: PatternRenderInput<PianoRollView>): PatternRenderModel {
    return {
      rendererId: this.id,
      patternName: input.viewModel.patternName,
      viewport: input.viewport,
      grid: input.grid,
      visibleLength: input.visibleLength,
      pitchRows: input.viewModel.pitchRows,
      pitchCount: input.viewModel.pitchCount,
      highestPitch: input.viewModel.highestPitch,
      gridLines: input.gridLines,
      notes: input.viewModel.notes,
      selectedNoteIds: input.selectedNotes.map((note) => note.id),
      hoveredNoteId: input.hoveredNoteId,
      activeToolId: input.activeToolId,
      isPanning: input.isPanning,
      noteHeight: input.noteHeight,
      ghost: input.ghost,
      overlayNotes: input.overlayNotes,
      overlayRectangles: input.overlayRectangles
    };
  }

  hitTest(
    viewModel: PianoRollView,
    viewport: PatternViewport,
    x: number,
    y: number
  ): PianoRollNoteView | undefined {
    return hitTestNote(
      viewModel.notes,
      viewport,
      viewModel.highestPitch,
      x,
      y
    );
  }

  pointerToMusical(
    viewModel: PianoRollView,
    viewport: PatternViewport,
    grid: GridDefinition,
    x: number,
    y: number
  ): PatternMusicalPoint {
    const beat = snapBeat(screenXToBeat(x, viewport), grid.snap);
    const pitch = clampPitch(
      screenYToPitch(y, viewport, viewModel.highestPitch),
      viewModel.lowestPitch,
      viewModel.highestPitch
    );

    return {
      beat,
      pitch,
      snap: grid.snap
    };
  }
}

function clampPitch(pitch: number, lowestPitch: number, highestPitch: number) {
  return Math.max(lowestPitch, Math.min(highestPitch, pitch));
}
