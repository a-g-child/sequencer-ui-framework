import { MoveNotesOperation } from '@sequencer/music';
import type {
  PatternInteractionContext,
  PatternOverlay,
  PatternTool
} from '../pattern-tool.ts';

type CapturedMovingNote = {
  id: string;
  startTime: number;
  startPitch: number;
  startVisualPitch: number;
  duration: number;
};

type CapturedMove = {
  patternId: string;
  notes: CapturedMovingNote[];
  pointerBeat: number;
  pointerPitch: number;
  pointerVisualPitch: number;
  pitchByVisualPitch: Record<number, number>;
  visualPitches: number[];
  beatDelta: number;
  visualPitchDelta: number;
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

    const itemByNoteId = new Map(
      context.visibleItems.map((item) => [item.source.id, item])
    );
    const pitchByVisualPitch = context.pitchByVisualPitch;

    this.capturedMove = {
      patternId: context.patternId,
      notes: movingNotes.map((note) => ({
        id: note.id,
        startTime: note.time,
        startPitch: note.pitch,
        startVisualPitch: itemByNoteId.get(note.id)?.visualPitch ?? note.pitch,
        duration: note.duration
      })),
      pointerBeat: context.musical.beat,
      pointerPitch: context.musical.pitch,
      pointerVisualPitch: context.musical.visualPitch ?? context.musical.pitch,
      pitchByVisualPitch,
      visualPitches: Object.keys(pitchByVisualPitch)
        .map(Number)
        .filter(Number.isFinite),
      beatDelta: 0,
      visualPitchDelta: 0
    };
  }

  pointerMove(context: PatternInteractionContext): void {
    this.updatePreview(context);
  }

  pointerUp(context: PatternInteractionContext): void {
    if (!this.capturedMove) return;

    this.updatePreview(context);

    const move = this.capturedMove;

    if (move.beatDelta !== 0 || move.visualPitchDelta !== 0) {
      context.controller.execute(
        new MoveNotesOperation(
          move.patternId,
          move.notes.map((note) => note.id),
          move.beatDelta,
          0,
          this.moveTargets()
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
      pitch:
        this.pitchForVisualPitch(
          note.startVisualPitch + this.capturedMove!.visualPitchDelta
        ) ?? note.startPitch,
      variant: 'ghost'
    }));
  }

  private updatePreview(context: PatternInteractionContext): void {
    if (!this.capturedMove) return;

    const beatDelta = context.musical.beat - this.capturedMove.pointerBeat;
    const visualPitchDelta =
      (context.musical.visualPitch ?? context.musical.pitch) -
      this.capturedMove.pointerVisualPitch;

    this.capturedMove.beatDelta = this.clampBeatDelta(beatDelta);
    this.capturedMove.visualPitchDelta =
      this.clampVisualPitchDelta(visualPitchDelta);
  }

  private clampBeatDelta(delta: number): number {
    if (!this.capturedMove) return delta;

    const minStartTime = Math.min(
      ...this.capturedMove.notes.map((note) => note.startTime)
    );

    return Math.max(-minStartTime, delta);
  }

  private clampVisualPitchDelta(delta: number): number {
    if (!this.capturedMove) return delta;

    const lowestPitch = Math.min(
      ...this.capturedMove.notes.map((note) => note.startVisualPitch)
    );
    const highestPitch = Math.max(
      ...this.capturedMove.notes.map((note) => note.startVisualPitch)
    );
    const availablePitches = this.capturedMove.visualPitches;

    if (availablePitches.length === 0) {
      return Math.min(127 - highestPitch, Math.max(-lowestPitch, delta));
    }

    return Math.min(
      Math.max(...availablePitches) - highestPitch,
      Math.max(Math.min(...availablePitches) - lowestPitch, delta)
    );
  }

  private moveTargets() {
    if (!this.capturedMove) return [];

    return this.capturedMove.notes.flatMap((note) => {
      const pitch = this.pitchForVisualPitch(
        note.startVisualPitch + this.capturedMove!.visualPitchDelta
      );

      if (pitch === undefined) return [];

      return {
        id: note.id,
        time: Math.max(0, note.startTime + this.capturedMove!.beatDelta),
        pitch
      };
    });
  }

  private pitchForVisualPitch(visualPitch: number): number | undefined {
    if (!this.capturedMove) return undefined;

    return this.capturedMove.pitchByVisualPitch[Math.round(visualPitch)];
  }
}
