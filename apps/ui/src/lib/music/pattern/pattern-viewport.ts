import type { BeatTime } from '@sequencer/core';

export type PatternViewport = {
  zoomX: number;
  zoomY: number;
  scrollX: BeatTime;
  scrollY: number;
  pixelsPerBeat: number;
  pixelsPerSemitone: number;
};

export type PatternViewportOptions = {
  zoomX?: number;
  zoomY?: number;
  scrollX?: BeatTime;
  scrollY?: number;
  basePixelsPerBeat?: number;
  basePixelsPerSemitone?: number;
};

const DEFAULT_PIXELS_PER_BEAT = 96;
const DEFAULT_PIXELS_PER_SEMITONE = 20;

export function createPatternViewport(
  options: PatternViewportOptions = {}
): PatternViewport {
  const zoomX = options.zoomX ?? 1;
  const zoomY = options.zoomY ?? 1;

  return {
    zoomX,
    zoomY,
    scrollX: options.scrollX ?? 0,
    scrollY: options.scrollY ?? 0,
    pixelsPerBeat: (options.basePixelsPerBeat ?? DEFAULT_PIXELS_PER_BEAT) * zoomX,
    pixelsPerSemitone:
      (options.basePixelsPerSemitone ?? DEFAULT_PIXELS_PER_SEMITONE) * zoomY
  };
}

export function beatToScreenX(
  beat: BeatTime,
  viewport: PatternViewport
): number {
  return (beat - viewport.scrollX) * viewport.pixelsPerBeat;
}

export function screenXToBeat(
  x: number,
  viewport: PatternViewport
): BeatTime {
  return x / viewport.pixelsPerBeat + viewport.scrollX;
}

export function durationToScreenWidth(
  duration: BeatTime,
  viewport: PatternViewport
): number {
  return duration * viewport.pixelsPerBeat;
}

export function pitchToScreenY(
  pitch: number,
  viewport: PatternViewport,
  highestPitch: number
): number {
  return (highestPitch - pitch - viewport.scrollY) * viewport.pixelsPerSemitone;
}

export function screenYToPitch(
  y: number,
  viewport: PatternViewport,
  highestPitch: number
): number {
  return highestPitch - Math.floor(y / viewport.pixelsPerSemitone + viewport.scrollY);
}

export function pitchRangeToScreenHeight(
  pitchCount: number,
  viewport: PatternViewport
): number {
  return pitchCount * viewport.pixelsPerSemitone;
}

export function patternLengthToScreenWidth(
  length: BeatTime,
  viewport: PatternViewport
): number {
  return durationToScreenWidth(length, viewport);
}

export function snapBeat(beat: BeatTime, snap: BeatTime): BeatTime {
  return Math.max(0, Math.floor(beat / snap) * snap);
}
