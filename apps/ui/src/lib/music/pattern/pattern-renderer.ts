import type { BeatTime } from '@sequencer/core';
import type { PianoRollNoteView, PianoRollView } from '../../editors/piano-roll/piano-roll-model';
import type { RenderModel } from '../../framework/editor';
import {
  getGeneralMidiDrumLaneLabel,
  getGeneralMidiDrumLanes
} from './sample-grid-lane-provider';
import type { GridDefinition, PatternGridLine } from './pattern-grid';
import type { RenderItem, RenderLane } from './pattern-render-items';
import {
  defaultScaleState,
  isPitchInScale,
  type PatternScaleState
} from './pattern-scale';
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
  visualPitch?: number;
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
  pitchByVisualPitch: Record<number, number>;
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
  scale: PatternScaleState;
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
  scale?: PatternScaleState;
};

export interface PatternRenderer<TViewModel> {
  readonly id: string;

  render(input: PatternRenderInput<TViewModel>): PatternRenderModel;
  pointerToMusical(
    viewModel: TViewModel,
    viewport: PatternViewport,
    grid: GridDefinition,
    x: number,
    y: number,
    renderModel?: PatternRenderModel
  ): PatternMusicalPoint;
}

export class PianoRollRenderer implements PatternRenderer<PianoRollView> {
  readonly id = 'piano-roll';

  render(input: PatternRenderInput<PianoRollView>): PatternRenderModel {
    const scale = input.scale ?? defaultScaleState;
    const shouldFold = scale.mode === 'fold';
    const pitchRows = shouldFold
      ? input.viewModel.pitchRows.filter((pitch) => isPitchInScale(pitch, scale))
      : input.viewModel.pitchRows;
    const highestPitch = shouldFold
      ? Math.max(0, pitchRows.length - 1)
      : input.viewModel.highestPitch;
    const visualPitchByPitch = new Map(
      pitchRows.map((pitch, index) => [
        pitch,
        shouldFold ? pitchRows.length - 1 - index : pitch
      ])
    );
    const pitchByVisualPitch = Object.fromEntries(
      pitchRows.map((pitch) => [visualPitchByPitch.get(pitch) ?? pitch, pitch])
    );
    const pitchLabels = Object.fromEntries(
      pitchRows.map((pitch) => [pitch, noteName(pitch)])
    );
    const lanes = buildRenderLanes(
      pitchRows.map((pitch) => ({
        id: String(pitch),
        pitch: visualPitchByPitch.get(pitch) ?? pitch,
        label: pitchLabels[pitch] ?? String(pitch),
        inScale: isPitchInScale(pitch, scale),
        source: pitch
      })),
      input.viewport,
      highestPitch
    );
    const selectedIds = input.selectedNotes.map((note) => note.id);
    const selectedIdSet = new Set(selectedIds);

    return {
      rendererId: this.id,
      patternName: input.viewModel.patternName,
      viewport: input.viewport,
      grid: input.grid,
      visibleLength: input.visibleLength,
      pitchRows,
      pitchCount: pitchRows.length,
      highestPitch,
      pitchLabels,
      pitchByVisualPitch,
      lanes,
      items: buildRenderItems({
        notes: input.viewModel.notes,
        laneByPitch: new Map(pitchRows.map((pitch) => [pitch, String(pitch)])),
        visualPitchByPitch,
        viewport: input.viewport,
        highestPitch,
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
      overlayRectangles: input.overlayRectangles,
      scale
    };
  }

  pointerToMusical(
    viewModel: PianoRollView,
    viewport: PatternViewport,
    grid: GridDefinition,
    x: number,
    y: number,
    renderModel?: PatternRenderModel
  ): PatternMusicalPoint {
    const beat = snapBeat(screenXToBeat(x, viewport), grid.snap);
    const highestPitch = renderModel?.highestPitch ?? viewModel.highestPitch;
    const visualPitch = clampPitch(
      screenYToPitch(y, viewport, highestPitch),
      0,
      highestPitch
    );
    const pitch = clampPitch(
      renderModel?.pitchByVisualPitch[visualPitch] ?? visualPitch,
      viewModel.lowestPitch,
      viewModel.highestPitch
    );

    return {
      beat,
      pitch,
      visualPitch,
      snap: grid.snap
    };
  }
}

export class SampleGridRenderer implements PatternRenderer<PianoRollView> {
  readonly id = 'sample-grid';

  render(input: PatternRenderInput<PianoRollView>): PatternRenderModel {
    const lanes = buildSampleGridLanes();
    const laneByPitch = new Map(
      lanes.map((lane) => [lane.pitch, lane.lanePitch])
    );
    const pitchByVisualPitch = Object.fromEntries(
      lanes.map((lane) => [lane.lanePitch, lane.pitch])
    );
    const laneIdByPitch = new Map(
      lanes.map((lane) => [lane.pitch, String(lane.pitch)])
    );
    const labelByLane = Object.fromEntries(
      lanes.map((lane) => [lane.lanePitch, lane.label])
    );
    const highestLanePitch = highestVisualPitch(lanes);
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
      highestLanePitch
    );

    return {
      rendererId: this.id,
      patternName: input.viewModel.patternName,
      viewport: input.viewport,
      grid: input.grid,
      visibleLength: input.visibleLength,
      pitchRows: lanes.map((lane) => lane.lanePitch),
      pitchCount: lanes.length,
      highestPitch: highestLanePitch,
      pitchLabels: labelByLane,
      pitchByVisualPitch,
      lanes: renderLanes,
      items: buildRenderItems({
        notes: input.viewModel.notes,
        laneByPitch: laneIdByPitch,
        visualPitchByPitch: laneByPitch,
        viewport: input.viewport,
        highestPitch: highestLanePitch,
        noteHeight: Math.max(12, input.noteHeight),
        selectedIds: selectedIdSet,
        hoveredNoteId: input.hoveredNoteId
      }),
      gridLines: input.gridLines,
      notes: input.viewModel.notes.map((note) => ({
        ...note,
        source: note,
        lanePitch: laneByPitch.get(note.pitch) ?? 0,
        label: getGeneralMidiDrumLaneLabel(note.pitch) ?? String(note.pitch)
      })),
      selectedNoteIds: selectedIds,
      hoveredNoteId: input.hoveredNoteId,
      activeToolId: input.activeToolId,
      isPanning: input.isPanning,
      noteHeight: Math.max(12, input.noteHeight),
      ghost: input.ghost,
      overlayNotes: input.overlayNotes,
      overlayRectangles: input.overlayRectangles,
      scale: input.scale ?? defaultScaleState
    };
  }

  pointerToMusical(
    _viewModel: PianoRollView,
    viewport: PatternViewport,
    grid: GridDefinition,
    x: number,
    y: number,
    _renderModel?: PatternRenderModel
  ): PatternMusicalPoint {
    const lanes = buildSampleGridLanes();
    const highestLanePitch = highestVisualPitch(lanes);
    const lanePitch = clampPitch(
      screenYToPitch(y, viewport, highestLanePitch),
      0,
      highestLanePitch
    );
    const lane = lanes.find((item) => item.lanePitch === lanePitch);

    return {
      beat: snapBeat(screenXToBeat(x, viewport), grid.snap),
      pitch: lane?.pitch ?? 60,
      visualPitch: lanePitch,
      snap: grid.snap
    };
  }
}

function clampPitch(pitch: number, lowestPitch: number, highestPitch: number) {
  return Math.max(lowestPitch, Math.min(highestPitch, pitch));
}

export const SAMPLE_GRID_LANE_COUNT = getGeneralMidiDrumLanes().length;

function buildSampleGridLanes() {
  return getGeneralMidiDrumLanes().map((lane, index) => ({
    ...lane,
    lanePitch: index
  }));
}

function highestVisualPitch(lanes: Array<{ lanePitch: number }>): number {
  return Math.max(0, ...lanes.map((lane) => lane.lanePitch));
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
      inScale?: boolean;
  }>,
  viewport: PatternViewport,
  highestPitch: number
): RenderLane[] {
  return lanes.map((lane) => ({
    id: lane.id,
    label: lane.label,
    y: pitchToScreenY(lane.pitch, viewport, highestPitch),
    height: viewport.pixelsPerSemitone,
    inScale: lane.inScale,
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
  return options.notes.flatMap((note) => {
    const laneId = options.laneByPitch.get(note.pitch);
    const visualPitch = options.visualPitchByPitch?.get(note.pitch) ?? note.pitch;

    if (!laneId) return [];

    return {
      id: note.id,
      laneId,
      x: beatToScreenX(
        Math.max(0, note.time + note.humanizeOffset),
        options.viewport
      ),
      y: pitchToScreenY(visualPitch, options.viewport, options.highestPitch) + 1,
      width: durationToScreenWidth(note.duration, options.viewport),
      height: options.noteHeight,
      visualPitch,
      selected: options.selectedIds.has(note.id),
      hovered: options.hoveredNoteId === note.id,
      source: note
    };
  });
}
