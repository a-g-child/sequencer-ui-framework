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
  isMajor: boolean;
  label?: string;
};

export function createGridDefinition(
  definition: Partial<GridDefinition> = {}
): GridDefinition {
  return {
    snap: definition.snap ?? 0.25,
    majorEvery: definition.majorEvery ?? 4,
    subdivision: definition.subdivision ?? 4,
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
    const isMajor = isGridMajorBeat(beat, definition);

    return {
      id: `grid-${beat}`,
      beat,
      isMajor,
      label: isMajor ? String(beat) : undefined
    };
  });
}

function isGridMajorBeat(
  beat: BeatTime,
  definition: GridDefinition
): boolean {
  if (!definition.showBars) {
    return Number.isInteger(beat);
  }

  return beat % definition.majorEvery === 0;
}
