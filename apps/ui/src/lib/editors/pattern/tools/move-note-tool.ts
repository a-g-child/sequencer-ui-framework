import { MoveNoteOperation } from '@sequencer/music';
import type {
  PatternInteractionContext,
  PatternOverlay,
  PatternTool
} from '../pattern-tool';

type CapturedNote = {
  patternId: string;
  noteId: string;
  startTime: number;
  startPitch: number;
  duration: number;
  pointerBeat: number;
  pointerPitch: number;
  previewTime: number;
  previewPitch: number;
};

export class MoveNoteTool implements PatternTool {
  readonly id = 'move-note';
  readonly name = 'Move';

  private capturedNote?: CapturedNote;

  pointerDown(context: PatternInteractionContext): void {
    if (!context.hoveredNote) return;

    this.capturedNote = {
      patternId: context.patternId,
      noteId: context.hoveredNote.id,
      startTime: context.hoveredNote.time,
      startPitch: context.hoveredNote.pitch,
      duration: context.hoveredNote.duration,
      pointerBeat: context.musical.beat,
      pointerPitch: context.musical.pitch,
      previewTime: context.hoveredNote.time,
      previewPitch: context.hoveredNote.pitch
    };
  }

  pointerMove(context: PatternInteractionContext): void {
    this.updatePreview(context);
  }

  pointerUp(context: PatternInteractionContext): void {
    if (!this.capturedNote) return;

    this.updatePreview(context);

    const note = this.capturedNote;

    if (note.previewTime !== note.startTime || note.previewPitch !== note.startPitch) {
      context.controller.execute(
        new MoveNoteOperation(
          note.patternId,
          note.noteId,
          note.previewTime,
          note.previewPitch
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
          id: `move-preview-${this.capturedNote.noteId}`,
          time: this.capturedNote.previewTime,
          duration: this.capturedNote.duration,
          pitch: this.capturedNote.previewPitch,
          variant: 'ghost'
        }
      ]
    };
  }

  private updatePreview(context: PatternInteractionContext): void {
    if (!this.capturedNote) return;

    const beatDelta = context.musical.beat - this.capturedNote.pointerBeat;
    const pitchDelta = context.musical.pitch - this.capturedNote.pointerPitch;

    this.capturedNote.previewTime = Math.max(
      0,
      this.capturedNote.startTime + beatDelta
    );
    this.capturedNote.previewPitch = Math.min(
      127,
      Math.max(0, this.capturedNote.startPitch + pitchDelta)
    );
  }
}
