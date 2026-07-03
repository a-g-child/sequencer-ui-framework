export type PatternScaleMode = 'off' | 'highlight' | 'fold';

export type PatternScaleState = {
  root: number;
  scaleId: string;
  mode: PatternScaleMode;
};

export type PatternScaleDefinition = {
  id: string;
  name: string;
  intervals: number[];
};

export const scaleRoots = [
  { value: 0, name: 'C' },
  { value: 1, name: 'C#' },
  { value: 2, name: 'D' },
  { value: 3, name: 'D#' },
  { value: 4, name: 'E' },
  { value: 5, name: 'F' },
  { value: 6, name: 'F#' },
  { value: 7, name: 'G' },
  { value: 8, name: 'G#' },
  { value: 9, name: 'A' },
  { value: 10, name: 'A#' },
  { value: 11, name: 'B' }
];

export const scaleDefinitions: PatternScaleDefinition[] = [
  { id: 'major', name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'dorian', name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixolydian', name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'minor-pentatonic', name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  { id: 'major-pentatonic', name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  { id: 'chromatic', name: 'Chromatic', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
];

export const defaultScaleState: PatternScaleState = {
  root: 0,
  scaleId: 'major',
  mode: 'off'
};

export function isPitchInScale(
  pitch: number,
  scale: PatternScaleState
): boolean {
  if (scale.mode === 'off') return false;

  const definition = scaleDefinitions.find((item) => item.id === scale.scaleId) ??
    scaleDefinitions[0];
  const scaleDegree = positiveModulo(pitch - scale.root, 12);

  return definition.intervals.includes(scaleDegree);
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}
