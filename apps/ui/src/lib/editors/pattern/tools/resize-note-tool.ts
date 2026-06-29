import { ResizeNoteOperation } from '@sequencer/music';
import type {
  PatternInteractionContext,
  PatternOverlay,
  PatternTool
} from '../pattern-tool';

type CapturedNote = {
  patternId: string;
  noteId: string;
  time: number;
  pitch: number;
  startDuration: number;
  pointerBeat: number;
  previewDuration: number;
};

export class ResizeNoteTool implements PatternTool {
  readonly id = 'resize-note';
  readonly name = 'Resize';

  private capturedNote?: CapturedNote;

  pointerDown(context: PatternInteractionContext): void {
    if (!context.hoveredNote) return;

    this.capturedNote = {
      patternId: context.patternId,
      noteId: context.hoveredNote.id,
      time: context.hoveredNote.time,
      pitch: context.hoveredNote.pitch,
      startDuration: context.hoveredNote.duration,
      pointerBeat: context.musical.beat,
      previewDuration: context.hoveredNote.duration
    };
  }

  pointerMove(context: PatternInteractionContext): void {
    this.updatePreview(context);
  }

  pointerUp(context: PatternInteractionContext): void {
    if (!this.capturedNote) return;

    this.updatePreview(context);

    const note = this.capturedNote;

    if (note.previewDuration !== note.startDuration) {
      context.controller.execute(
        new ResizeNoteOperation(
          note.patternId,
          note.noteId,
          note.previewDuration
        )
      );
    }

    this.capturedNote = undefined;
  }

  pointerLeave(context: PatternInteractionContext): void {
    this.updatePreview(context);
  }

  cancel(): void {
    this.capturedNote = undefined;
  }

  drawOverlay(): PatternOverlay | undefined {
    if (!this.capturedNote) return undefined;

    return {
      notes: [
        {
          id: `resize-preview-${this.capturedNote.noteId}`,
          time: this.capturedNote.time,
          duration: this.capturedNote.previewDuration,
          pitch: this.capturedNote.pitch,
          variant: 'ghost'
        }
      ]
    };
  }

  private updatePreview(context: PatternInteractionContext): void {
    if (!this.capturedNote) return;

    const beatDelta = context.musical.beat - this.capturedNote.pointerBeat;

    this.capturedNote.previewDuration = Math.max(
      context.musical.snap,
      this.capturedNote.startDuration + beatDelta
    );
  }
}
