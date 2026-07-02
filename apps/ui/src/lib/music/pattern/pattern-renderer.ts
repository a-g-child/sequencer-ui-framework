import type { BeatTime } from '@sequencer/core';
import type { PianoRollNoteView, PianoRollView } from '../../editors/piano-roll/piano-roll-model';
import type { RenderModel } from '../../framework/editor';
import type { GridDefinition, PatternGridLine } from './pattern-grid';
import { hitTestNote } from './pattern-hit-testing';
import type { RenderItem, RenderLane } from './pattern-render-items';
import type { PatternNoteOverlay, PatternRectangleOverlay } from './pattern-tool';
import {
  beatToScreenX,
  durationToScreenWidth,
  pitchToScreenY,
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
  lanes: RenderLane[];
  items: RenderItem<PianoRollNoteView>[];
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
    const pitchLabels = Object.fromEntries(
      input.viewModel.pitchRows.map((pitch) => [pitch, noteName(pitch)])
    );
    const lanes = buildRenderLanes(
      input.viewModel.pitchRows.map((pitch) => ({
        id: String(pitch),
        pitch,
        label: pitchLabels[pitch] ?? String(pitch),
        source: pitch
      })),
      input.viewport,
      input.viewModel.highestPitch
    );
    const selectedIds = input.selectedNotes.map((note) => note.id);
    const selectedIdSet = new Set(selectedIds);

    return {
      rendererId: this.id,
      patternName: input.viewModel.patternName,
      viewport: input.viewport,
      grid: input.grid,
      visibleLength: input.visibleLength,
      pitchRows: input.viewModel.pitchRows,
      pitchCount: input.viewModel.pitchCount,
      highestPitch: input.viewModel.highestPitch,
      pitchLabels,
      lanes,
      items: buildRenderItems({
        notes: input.viewModel.notes,
        laneByPitch: new Map(input.viewModel.pitchRows.map((pitch) => [pitch, String(pitch)])),
        viewport: input.viewport,
        highestPitch: input.viewModel.highestPitch,
        noteHeight: input.noteHeight,
        selectedIds: selectedIdSet,
        hoveredNoteId: input.hoveredNoteId
      }),
      gridLines: input.gridLines,
      notes: input.viewModel.notes.map((note) => ({
        ...note,
        source: note,
        lanePitch: note.pitch,
        label: noteName(note.pitch)
      })),
      selectedNoteIds: selectedIds,
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
    const laneIdByPitch = new Map(
      lanes.map((lane) => [lane.pitch, String(lane.pitch)])
    );
    const labelByLane = Object.fromEntries(
      lanes.map((lane) => [lane.lanePitch, lane.label])
    );
    const selectedIds = input.selectedNotes.map((note) => note.id);
    const selectedIdSet = new Set(selectedIds);
    const renderLanes = buildRenderLanes(
      lanes.map((lane) => ({
        id: String(lane.pitch),
        pitch: lane.lanePitch,
        label: lane.label,
        source: lane
      })),
      input.viewport,
      lanes[0]?.lanePitch ?? 0
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
      lanes: renderLanes,
      items: buildRenderItems({
        notes: input.viewModel.notes,
        laneByPitch: laneIdByPitch,
        visualPitchByPitch: laneByPitch,
        viewport: input.viewport,
        highestPitch: lanes[0]?.lanePitch ?? 0,
        noteHeight: Math.max(12, input.noteHeight),
        selectedIds: selectedIdSet,
        hoveredNoteId: input.hoveredNoteId
      }),
      gridLines: input.gridLines,
      notes: input.viewModel.notes.map((note) => ({
        ...note,
        source: note,
        lanePitch: laneByPitch.get(note.pitch) ?? 0,
        label: noteName(note.pitch)
      })),
      selectedNoteIds: selectedIds,
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

function buildRenderLanes(
  lanes: Array<{
    id: string;
    pitch: number;
    label: string;
    source?: unknown;
  }>,
  viewport: PatternViewport,
  highestPitch: number
): RenderLane[] {
  return lanes.map((lane) => ({
    id: lane.id,
    label: lane.label,
    y: pitchToScreenY(lane.pitch, viewport, highestPitch),
    height: viewport.pixelsPerSemitone,
    source: lane.source
  }));
}

function buildRenderItems(options: {
  notes: PianoRollNoteView[];
  laneByPitch: Map<number, string>;
  visualPitchByPitch?: Map<number, number>;
  viewport: PatternViewport;
  highestPitch: number;
  noteHeight: number;
  selectedIds: Set<string>;
  hoveredNoteId?: string;
}): RenderItem<PianoRollNoteView>[] {
  return options.notes.map((note) => {
    const visualPitch = options.visualPitchByPitch?.get(note.pitch) ?? note.pitch;

    return {
      id: note.id,
      laneId: options.laneByPitch.get(note.pitch) ?? String(note.pitch),
      x: beatToScreenX(note.time, options.viewport),
      y: pitchToScreenY(visualPitch, options.viewport, options.highestPitch) + 1,
      width: durationToScreenWidth(note.duration, options.viewport),
      height: options.noteHeight,
      selected: options.selectedIds.has(note.id),
      hovered: options.hoveredNoteId === note.id,
      source: note
    };
  });
}
