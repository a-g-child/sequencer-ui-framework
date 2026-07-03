import { SetNoteHumanizeOffsetsOperation } from '@sequencer/music';
import type {
  PatternInteractionContext,
  PatternOverlay,
  PatternTool
} from '../pattern-tool';

const maxHumanizeOffset = 0.125;

type CapturedHumanizingNote = {
  id: string;
  time: number;
  pitch: number;
  duration: number;
  startOffset: number;
};

type CapturedHumanize = {
  patternId: string;
  notes: CapturedHumanizingNote[];
  pointerX: number;
  deltaOffset: number;
};

export class HumanizeNoteTool implements PatternTool {
  readonly id = 'humanize-note';
  readonly name = 'Humanise';

  private capturedHumanize?: CapturedHumanize;

  pointerDown(context: PatternInteractionContext): void {
    const hoveredNote = context.hoveredItem?.source;

    if (!hoveredNote) return;

    const selectedNotes = context.selectedItems.map((item) => item.source);
    const selectedIds = selectedNotes.map((note) => note.id);
    const humanizingNotes =
      selectedIds.includes(hoveredNote.id)
        ? selectedNotes
        : [hoveredNote];

    this.capturedHumanize = {
      patternId: context.patternId,
      notes: humanizingNotes.map((note) => ({
        id: note.id,
        time: note.time,
        pitch: note.pitch,
        duration: note.duration,
        startOffset: note.humanizeOffset
      })),
      pointerX: context.pointer.x,
      deltaOffset: 0
    };
  }

  pointerMove(context: PatternInteractionContext): void {
    this.updatePreview(context);
  }

  pointerUp(context: PatternInteractionContext): void {
    if (!this.capturedHumanize) return;

    this.updatePreview(context);

    const humanize = this.capturedHumanize;

    if (humanize.deltaOffset !== 0) {
      context.controller.execute(
        new SetNoteHumanizeOffsetsOperation(
          humanize.patternId,
          humanize.notes.map((note) => ({
            id: note.id,
            offset: this.offsetForNote(note)
          }))
        )
      );
    }

    this.capturedHumanize = undefined;
  }

  pointerLeave(context: PatternInteractionContext): void {
    this.updatePreview(context);
  }

  cancel(): void {
    this.capturedHumanize = undefined;
  }

  drawOverlay(): PatternOverlay[] {
    if (!this.capturedHumanize) return [];

    return this.capturedHumanize.notes.map((note) => ({
      type: 'note',
      id: `humanize-preview-${note.id}`,
      time: note.time + this.offsetForNote(note),
      duration: note.duration,
      pitch: note.pitch,
      variant: 'ghost'
    }));
  }

  private updatePreview(context: PatternInteractionContext): void {
    if (!this.capturedHumanize) return;

    const rawDelta =
      (context.pointer.x - this.capturedHumanize.pointerX) /
      context.viewport.pixelsPerBeat;

    this.capturedHumanize.deltaOffset = rawDelta;
  }

  private offsetForNote(note: CapturedHumanizingNote): number {
    if (!this.capturedHumanize) return note.startOffset;

    const nextOffset = note.startOffset + this.capturedHumanize.deltaOffset;

    return Math.min(
      maxHumanizeOffset,
      Math.max(Math.max(-maxHumanizeOffset, -note.time), nextOffset)
    );
  }
}
