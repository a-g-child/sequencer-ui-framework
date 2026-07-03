import {
  createPatternViewport,
  type PatternViewport
} from './pattern-viewport';

const DEFAULT_PIXELS_PER_BEAT = 96;
const DEFAULT_PIXELS_PER_SEMITONE = 20;
const RESET_PIXELS_PER_BEAT = 80;
const RESET_PIXELS_PER_SEMITONE = 10;
const MIN_PIXELS_PER_BEAT = 20;
const MAX_PIXELS_PER_BEAT = 400;
const MIN_PIXELS_PER_SEMITONE = 6;
const MAX_PIXELS_PER_SEMITONE = 80;

export type PatternNavigationBounds = {
  maxScrollX: number;
  contentLength: number;
  viewportWidth: number;
  viewportHeight: number;
  pitchCount: number;
  minPixelsPerSemitone?: number;
  minScrollY: number;
  maxScrollY: number;
};

export function zoomViewportX(
  viewport: PatternViewport,
  factor: number,
  bounds: PatternNavigationBounds
): PatternViewport {
  const minPixelsPerBeat = minimumPixelsPerBeat(bounds);
  const nextPixelsPerBeat = clampNumber(
    viewport.pixelsPerBeat * factor,
    minPixelsPerBeat,
    MAX_PIXELS_PER_BEAT
  );

  return createPatternViewport({
    zoomX: nextPixelsPerBeat / DEFAULT_PIXELS_PER_BEAT,
    zoomY: viewport.zoomY,
    scrollX: clampNumber(
      viewport.scrollX,
      0,
      maxScrollX(bounds, nextPixelsPerBeat)
    ),
    scrollY: clampNumber(viewport.scrollY, bounds.minScrollY, bounds.maxScrollY)
  });
}

export function panViewportX(
  viewport: PatternViewport,
  deltaBeats: number,
  bounds: PatternNavigationBounds
): PatternViewport {
  return createPatternViewport({
    zoomX: viewport.zoomX,
    zoomY: viewport.zoomY,
    scrollX: clampNumber(
      viewport.scrollX + deltaBeats,
      0,
      maxScrollX(bounds, viewport.pixelsPerBeat)
    ),
    scrollY: clampNumber(viewport.scrollY, bounds.minScrollY, bounds.maxScrollY)
  });
}

export function panViewportY(
  viewport: PatternViewport,
  deltaPitch: number,
  bounds: PatternNavigationBounds
): PatternViewport {
  return createPatternViewport({
    zoomX: viewport.zoomX,
    zoomY: viewport.zoomY,
    scrollX: clampNumber(
      viewport.scrollX,
      0,
      maxScrollX(bounds, viewport.pixelsPerBeat)
    ),
    scrollY: clampNumber(
      viewport.scrollY + deltaPitch,
      bounds.minScrollY,
      bounds.maxScrollY
    )
  });
}

export function resetViewport(): PatternViewport {
  return createPatternViewport({
    zoomX: RESET_PIXELS_PER_BEAT / DEFAULT_PIXELS_PER_BEAT,
    zoomY: RESET_PIXELS_PER_SEMITONE / DEFAULT_PIXELS_PER_SEMITONE
  });
}

export function clampViewport(
  viewport: PatternViewport,
  bounds: PatternNavigationBounds
): PatternViewport {
  const minPixelsPerBeat = minimumPixelsPerBeat(bounds);
  const pixelsPerBeat = clampNumber(
    viewport.pixelsPerBeat,
    minPixelsPerBeat,
    MAX_PIXELS_PER_BEAT
  );
  const pixelsPerSemitone = clampNumber(
    viewport.pixelsPerSemitone,
    bounds.minPixelsPerSemitone ?? MIN_PIXELS_PER_SEMITONE,
    MAX_PIXELS_PER_SEMITONE
  );

  return createPatternViewport({
    zoomX: pixelsPerBeat / DEFAULT_PIXELS_PER_BEAT,
    zoomY: pixelsPerSemitone / DEFAULT_PIXELS_PER_SEMITONE,
    scrollX: clampNumber(
      viewport.scrollX,
      0,
      maxScrollX(bounds, pixelsPerBeat)
    ),
    scrollY: clampNumber(viewport.scrollY, bounds.minScrollY, bounds.maxScrollY)
  });
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function minimumPixelsPerBeat(bounds: PatternNavigationBounds): number {
  if (bounds.contentLength <= 0 || bounds.viewportWidth <= 0) {
    return MIN_PIXELS_PER_BEAT;
  }

  return Math.min(
    MAX_PIXELS_PER_BEAT,
    Math.max(MIN_PIXELS_PER_BEAT, bounds.viewportWidth / bounds.contentLength)
  );
}

function maxScrollX(
  bounds: PatternNavigationBounds,
  pixelsPerBeat: number
): number {
  if (bounds.viewportWidth <= 0) return bounds.maxScrollX;

  return Math.max(0, bounds.contentLength - bounds.viewportWidth / pixelsPerBeat);
}
