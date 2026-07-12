import type { PatternNoteView } from './pattern-tool.ts';

export type PatternSelectionBounds = {
  startBeat: number;
  endBeat: number;
  lowestPitch: number;
  highestPitch: number;
};

export type PatternSelection = {
  primary?: PatternNoteView;
  secondary: PatternNoteView[];
  bounds?: PatternSelectionBounds;
};

export function buildPatternSelection(notes: PatternNoteView[]): PatternSelection {
  const [primary, ...secondary] = notes;

  return {
    primary,
    secondary,
    bounds: notes.length > 0 ? calculateSelectionBounds(notes) : undefined
  };
}

function calculateSelectionBounds(notes: PatternNoteView[]): PatternSelectionBounds {
  return {
    startBeat: Math.min(...notes.map((note) => note.time)),
    endBeat: Math.max(...notes.map((note) => note.time + note.duration)),
    lowestPitch: Math.min(...notes.map((note) => note.pitch)),
    highestPitch: Math.max(...notes.map((note) => note.pitch))
  };
}
