import type { BeatTime } from '@sequencer/core';

export type GridDefinition = {
  snap: BeatTime;
  majorEvery: number;
  subdivision: number;
  showBars: boolean;
};

export type PatternGridLine = {
  id: string;
  beat: BeatTime;
  kind: 'division' | 'beat' | 'bar';
  isBeat: boolean;
  isBar: boolean;
  label?: string;
};

const beatPrecision = 1e-6;

export function createGridDefinition(
  definition: Partial<GridDefinition> = {}
): GridDefinition {
  const subdivision = normaliseSubdivision(definition.subdivision);

  return {
    snap: definition.snap ?? 1 / subdivision,
    majorEvery: definition.majorEvery ?? 4,
    subdivision,
    showBars: definition.showBars ?? true
  };
}

export function buildPatternGridLines(
  length: BeatTime,
  definition: GridDefinition
): PatternGridLine[] {
  const lineCount = Math.floor(length / definition.snap);

  return Array.from({ length: lineCount + 1 }, (_, index) => {
    const beat = index * definition.snap;
    const isBeat = isGridBeat(beat);
    const isBar = isGridBar(beat, definition);

    return {
      id: `grid-${beat}`,
      beat,
      kind: isBar ? 'bar' : isBeat ? 'beat' : 'division',
      isBeat,
      isBar,
      label: isBar ? formatGridLabel(beat) : undefined
    };
  });
}

function isGridBeat(beat: BeatTime): boolean {
  return Math.abs(beat - Math.round(beat)) < beatPrecision;
}

function isGridBar(
  beat: BeatTime,
  definition: GridDefinition
): boolean {
  if (!definition.showBars) {
    return isGridBeat(beat);
  }

  return Math.abs(beat / definition.majorEvery - Math.round(beat / definition.majorEvery)) <
    beatPrecision;
}

function normaliseSubdivision(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 4;

  return Math.max(1, Math.floor(value));
}

function formatGridLabel(beat: BeatTime): string {
  return String(Math.round(beat));
}
