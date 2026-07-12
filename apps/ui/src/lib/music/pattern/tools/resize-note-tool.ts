import { ResizeNotesOperation } from '@sequencer/music';
import type {
  PatternInteractionContext,
  PatternOverlay,
  PatternTool
} from '../pattern-tool.ts';

type CapturedResizingNote = {
  id: string;
  time: number;
  pitch: number;
  startDuration: number;
};

type CapturedResize = {
  patternId: string;
  notes: CapturedResizingNote[];
  pointerBeat: number;
  deltaDuration: number;
  minDuration: number;
};

export class ResizeNoteTool implements PatternTool {
  readonly id = 'resize-note';
  readonly name = 'Resize';

  private capturedResize?: CapturedResize;

  pointerDown(context: PatternInteractionContext): void {
    const hoveredNote = context.hoveredItem?.source;

    if (!hoveredNote) return;

    const selectedNotes = context.selectedItems.map((item) => item.source);
    const selectedIds = selectedNotes.map((note) => note.id);
    const resizingNotes =
      selectedIds.includes(hoveredNote.id)
        ? selectedNotes
        : [hoveredNote];

    this.capturedResize = {
      patternId: context.patternId,
      notes: resizingNotes.map((note) => ({
        id: note.id,
        time: note.time,
        pitch: note.pitch,
        startDuration: note.duration
      })),
      pointerBeat: context.musical.beat,
      deltaDuration: 0,
      minDuration: context.musical.snap
    };
  }

  pointerMove(context: PatternInteractionContext): void {
    this.updatePreview(context);
  }

  pointerUp(context: PatternInteractionContext): void {
    if (!this.capturedResize) return;

    this.updatePreview(context);

    const resize = this.capturedResize;

    if (resize.deltaDuration !== 0) {
      context.controller.execute(
        new ResizeNotesOperation(
          resize.patternId,
          resize.notes.map((note) => note.id),
          resize.deltaDuration,
          resize.minDuration
        )
      );
    }

    this.capturedResize = undefined;
  }

  pointerLeave(context: PatternInteractionContext): void {
    this.updatePreview(context);
  }

  cancel(): void {
    this.capturedResize = undefined;
  }

  drawOverlay(): PatternOverlay[] {
    if (!this.capturedResize) return [];

    return this.capturedResize.notes.map((note) => ({
      type: 'note',
      id: `resize-preview-${note.id}`,
      time: note.time,
      duration: Math.max(
        this.capturedResize!.minDuration,
        note.startDuration + this.capturedResize!.deltaDuration
      ),
      pitch: note.pitch,
      variant: 'ghost'
    }));
  }

  private updatePreview(context: PatternInteractionContext): void {
    if (!this.capturedResize) return;

    const beatDelta = context.musical.beat - this.capturedResize.pointerBeat;

    this.capturedResize.deltaDuration = this.clampDurationDelta(beatDelta);
  }

  private clampDurationDelta(delta: number): number {
    if (!this.capturedResize) return delta;

    const shortestDuration = Math.min(
      ...this.capturedResize.notes.map((note) => note.startDuration)
    );

    return Math.max(this.capturedResize.minDuration - shortestDuration, delta);
  }
}
