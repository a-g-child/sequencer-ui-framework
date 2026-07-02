import { MoveNotesOperation } from '@sequencer/music';
import type {
  PatternInteractionContext,
  PatternOverlay,
  PatternTool
} from '../pattern-tool';

type CapturedMovingNote = {
  id: string;
  startTime: number;
  startPitch: number;
  duration: number;
};

type CapturedMove = {
  patternId: string;
  notes: CapturedMovingNote[];
  pointerBeat: number;
  pointerPitch: number;
  beatDelta: number;
  pitchDelta: number;
};

export class MoveNoteTool implements PatternTool {
  readonly id = 'move-note';
  readonly name = 'Move';

  private capturedMove?: CapturedMove;

  pointerDown(context: PatternInteractionContext): void {
    const hoveredNote = context.hoveredItem?.source;

    if (!hoveredNote) return;

    const selectedNotes = context.selectedItems.map((item) => item.source);
    const selectedIds = selectedNotes.map((note) => note.id);
    const movingNotes =
      selectedIds.includes(hoveredNote.id)
        ? selectedNotes
        : [hoveredNote];

    this.capturedMove = {
      patternId: context.patternId,
      notes: movingNotes.map((note) => ({
        id: note.id,
        startTime: note.time,
        startPitch: note.pitch,
        duration: note.duration
      })),
      pointerBeat: context.musical.beat,
      pointerPitch: context.musical.pitch,
      beatDelta: 0,
      pitchDelta: 0
    };
  }

  pointerMove(context: PatternInteractionContext): void {
    this.updatePreview(context);
  }

  pointerUp(context: PatternInteractionContext): void {
    if (!this.capturedMove) return;

    this.updatePreview(context);

    const move = this.capturedMove;

    if (move.beatDelta !== 0 || move.pitchDelta !== 0) {
      context.controller.execute(
        new MoveNotesOperation(
          move.patternId,
          move.notes.map((note) => note.id),
          move.beatDelta,
          move.pitchDelta
        )
      );
    }

    this.capturedMove = undefined;
  }

  pointerLeave(context: PatternInteractionContext): void {
    this.updatePreview(context);
  }

  cancel(): void {
    this.capturedMove = undefined;
  }

  drawOverlay(): PatternOverlay[] {
    if (!this.capturedMove) return [];

    return this.capturedMove.notes.map((note) => ({
      type: 'note',
      id: `move-preview-${note.id}`,
      time: Math.max(0, note.startTime + this.capturedMove!.beatDelta),
      duration: note.duration,
      pitch: note.startPitch + this.capturedMove!.pitchDelta,
      variant: 'ghost'
    }));
  }

  private updatePreview(context: PatternInteractionContext): void {
    if (!this.capturedMove) return;

    const beatDelta = context.musical.beat - this.capturedMove.pointerBeat;
    const pitchDelta = context.musical.pitch - this.capturedMove.pointerPitch;

    this.capturedMove.beatDelta = this.clampBeatDelta(beatDelta);
    this.capturedMove.pitchDelta = this.clampPitchDelta(pitchDelta);
  }

  private clampBeatDelta(delta: number): number {
    if (!this.capturedMove) return delta;

    const minStartTime = Math.min(
      ...this.capturedMove.notes.map((note) => note.startTime)
    );

    return Math.max(-minStartTime, delta);
  }

  private clampPitchDelta(delta: number): number {
    if (!this.capturedMove) return delta;

    const lowestPitch = Math.min(
      ...this.capturedMove.notes.map((note) => note.startPitch)
    );
    const highestPitch = Math.max(
      ...this.capturedMove.notes.map((note) => note.startPitch)
    );

    return Math.min(127 - highestPitch, Math.max(-lowestPitch, delta));
  }
}
