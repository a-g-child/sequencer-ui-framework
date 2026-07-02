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

export type PatternRenderedNoteView = PianoRollNoteView & {
  source: PianoRollNoteView;
  lanePitch: number;
  label: string;
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
  pitchLabels: Record<number, string>;
  gridLines: PatternGridLine[];
  notes: PatternRenderedNoteView[];
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
      pitchLabels: Object.fromEntries(
        input.viewModel.pitchRows.map((pitch) => [pitch, noteName(pitch)])
      ),
      gridLines: input.gridLines,
      notes: input.viewModel.notes.map((note) => ({
        ...note,
        source: note,
        lanePitch: note.pitch,
        label: noteName(note.pitch)
      })),
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

export class DrumRackRenderer implements PatternRenderer<PianoRollView> {
  readonly id = 'drum-rack';

  render(input: PatternRenderInput<PianoRollView>): PatternRenderModel {
    const lanes = buildDrumLanes(input.viewModel);
    const laneByPitch = new Map(
      lanes.map((lane) => [lane.pitch, lane.lanePitch])
    );
    const labelByLane = Object.fromEntries(
      lanes.map((lane) => [lane.lanePitch, lane.label])
    );

    return {
      rendererId: this.id,
      patternName: input.viewModel.patternName,
      viewport: input.viewport,
      grid: input.grid,
      visibleLength: input.visibleLength,
      pitchRows: lanes.map((lane) => lane.lanePitch),
      pitchCount: lanes.length,
      highestPitch: lanes[0]?.lanePitch ?? 0,
      pitchLabels: labelByLane,
      gridLines: input.gridLines,
      notes: input.viewModel.notes.map((note) => ({
        ...note,
        source: note,
        lanePitch: laneByPitch.get(note.pitch) ?? 0,
        label: noteName(note.pitch)
      })),
      selectedNoteIds: input.selectedNotes.map((note) => note.id),
      hoveredNoteId: input.hoveredNoteId,
      activeToolId: input.activeToolId,
      isPanning: input.isPanning,
      noteHeight: Math.max(12, input.noteHeight),
      ghost: undefined,
      overlayNotes: [],
      overlayRectangles: input.overlayRectangles
    };
  }

  hitTest(
    viewModel: PianoRollView,
    viewport: PatternViewport,
    x: number,
    y: number
  ): PianoRollNoteView | undefined {
    const lanes = buildDrumLanes(viewModel);
    const laneByPitch = new Map(
      lanes.map((lane) => [lane.pitch, lane.lanePitch])
    );
    const renderedNotes = viewModel.notes.map((note) => ({
      ...note,
      pitch: laneByPitch.get(note.pitch) ?? 0
    }));

    const hit = hitTestNote(
      renderedNotes,
      viewport,
      lanes[0]?.lanePitch ?? 0,
      x,
      y
    );

    return hit ? viewModel.notes.find((note) => note.id === hit.id) : undefined;
  }

  pointerToMusical(
    viewModel: PianoRollView,
    viewport: PatternViewport,
    grid: GridDefinition,
    x: number,
    y: number
  ): PatternMusicalPoint {
    const lanes = buildDrumLanes(viewModel);
    const lanePitch = clampPitch(
      screenYToPitch(y, viewport, lanes[0]?.lanePitch ?? 0),
      0,
      Math.max(0, lanes.length - 1)
    );
    const lane = lanes.find((item) => item.lanePitch === lanePitch);

    return {
      beat: snapBeat(screenXToBeat(x, viewport), grid.snap),
      pitch: lane?.pitch ?? 60,
      snap: grid.snap
    };
  }
}

function clampPitch(pitch: number, lowestPitch: number, highestPitch: number) {
  return Math.max(lowestPitch, Math.min(highestPitch, pitch));
}

function buildDrumLanes(viewModel: PianoRollView) {
  const pitches = Array.from(
    new Set(viewModel.notes.map((note) => note.pitch))
  ).sort((left, right) => right - left);
  const lanePitches = pitches.length > 0 ? pitches : [60];
  const highestLanePitch = lanePitches.length - 1;

  return lanePitches.map((pitch, index) => ({
    pitch,
    lanePitch: highestLanePitch - index,
    label: noteName(pitch)
  }));
}

function noteName(pitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(pitch / 12) - 1;

  return `${names[pitch % 12]}${octave}`;
}
