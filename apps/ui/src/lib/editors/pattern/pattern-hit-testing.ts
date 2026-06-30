import type { PianoRollNoteView } from '../piano-roll/piano-roll-model';
import type { PatternViewport } from './pattern-viewport';
import {
  beatToScreenX,
  pitchToScreenY
} from './pattern-viewport';

export function hitTestNote(
  notes: PianoRollNoteView[],
  viewport: PatternViewport,
  highestPitch: number,
  x: number,
  y: number
): PianoRollNoteView | undefined {
  return notes.find((note) => {
    const left = beatToScreenX(note.time, viewport);
    const right = beatToScreenX(note.time + note.duration, viewport);
    const top = pitchToScreenY(note.pitch, viewport, highestPitch);
    const bottom = top + viewport.pixelsPerSemitone;

    return x >= left && x <= right && y >= top && y <= bottom;
  });
}
