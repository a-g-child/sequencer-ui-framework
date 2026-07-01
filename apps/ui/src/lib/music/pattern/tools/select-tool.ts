import {
  beatToScreenX,
  pitchToScreenY
} from '../pattern-viewport';
import type {
  PatternInteractionContext,
  PatternOverlay,
  PatternTool
} from '../pattern-tool';

export class SelectTool implements PatternTool {
  readonly id = 'select';
  readonly name = 'Select';

  private start?: { x: number; y: number };
  private current?: { x: number; y: number };

  pointerDown(context: PatternInteractionContext): void {
    if (context.hoveredNote) {
      context.controller.selectNoteById(context.patternId, context.hoveredNote.id);
      this.cancel();
      return;
    }

    this.start = context.pointer;
    this.current = context.pointer;
  }

  pointerMove(context: PatternInteractionContext): void {
    if (!this.start) return;

    this.current = context.pointer;
  }

  pointerUp(context: PatternInteractionContext): void {
    if (!this.start || !this.current) return;

    const minX = Math.min(this.start.x, this.current.x);
    const maxX = Math.max(this.start.x, this.current.x);
    const minY = Math.min(this.start.y, this.current.y);
    const maxY = Math.max(this.start.y, this.current.y);

    const selected = context.visibleNotes.filter((note) => {
      const noteLeft = beatToScreenX(note.time, context.viewport);
      const noteRight = beatToScreenX(note.time + note.duration, context.viewport);
      const noteTop = pitchToScreenY(
        note.pitch,
        context.viewport,
        context.highestPitch
      );
      const noteBottom = noteTop + context.viewport.pixelsPerSemitone;

      return (
        noteRight >= minX &&
        noteLeft <= maxX &&
        noteBottom >= minY &&
        noteTop <= maxY
      );
    });

    context.controller.selectNotes(
      context.patternId,
      selected.map((note) => note.id)
    );

    this.cancel();
  }

  cancel(): void {
    this.start = undefined;
    this.current = undefined;
  }

  drawOverlay(): PatternOverlay[] {
    if (!this.start || !this.current) return [];

    const x = Math.min(this.start.x, this.current.x);
    const y = Math.min(this.start.y, this.current.y);
    const width = Math.abs(this.current.x - this.start.x);
    const height = Math.abs(this.current.y - this.start.y);

    return [
      {
        type: 'rectangle',
        id: 'marquee',
        x,
        y,
        width,
        height
      }
    ];
  }
}
