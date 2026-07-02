import type { BeatTime } from '@sequencer/core';
import type { AppController } from '../../app-controller';
import type { PianoRollNoteView } from '../../editors/piano-roll/piano-roll-model';
import type { RenderInteractionItem } from '../../framework/editor';
import type { PatternModifierState } from './pattern-input-state';
import type { PatternViewport } from './pattern-viewport';

export type PatternNoteView = PianoRollNoteView;

export type PatternInteractionContext = {
  controller: AppController;
  patternId: string;
  viewport: PatternViewport;
  highestPitch: number;
  modifiers: PatternModifierState;
  pointer: {
    x: number;
    y: number;
  };
  musical: {
    beat: BeatTime;
    pitch: number;
    snap: BeatTime;
  };
  hoveredItem?: RenderInteractionItem<PatternNoteView>;
  selectedItems: RenderInteractionItem<PatternNoteView>[];
  visibleItems: RenderInteractionItem<PatternNoteView>[];
};

export type PatternPointerContext = PatternInteractionContext;

export type PatternKeyContext = {
  controller: AppController;
  patternId: string;
  key: string;
  selectedNotes: PatternNoteView[];
};

export type PatternNoteOverlay = {
  type: 'note';
  id: string;
  time: BeatTime;
  duration: BeatTime;
  pitch: number;
  label?: string;
  variant?: 'preview' | 'ghost';
};

export type PatternRectangleOverlay = {
  type: 'rectangle';
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PatternOverlay = PatternNoteOverlay | PatternRectangleOverlay;

export interface PatternTool {
  readonly id: string;
  readonly name: string;

  pointerEnter?(context: PatternInteractionContext): void;
  pointerDown(context: PatternInteractionContext): void;
  pointerMove?(context: PatternInteractionContext): void;
  pointerUp?(context: PatternInteractionContext): void;
  pointerLeave?(context: PatternInteractionContext): void;
  keyDown?(context: PatternKeyContext): void;
  cancel?(): void;
  drawOverlay?(context: PatternInteractionContext): PatternOverlay[];
}
