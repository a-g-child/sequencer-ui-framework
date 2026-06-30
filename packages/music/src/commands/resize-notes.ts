import type { EntityId, Operation, SequencerDocument } from '@sequencer/core';
import { isNoteEvent } from '../note-event';

type PreviousNoteState = {
  id: EntityId;
  duration: number;
};

export class ResizeNotesOperation implements Operation {
  readonly name = 'Resize Notes';

  private previous: PreviousNoteState[] = [];

  constructor(
    private readonly patternId: EntityId,
    private readonly noteIds: EntityId[],
    private readonly deltaDuration: number,
    private readonly minDuration = 0.25
  ) {}

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId);
    this.previous = [];

    for (const event of pattern.events) {
      if (!this.noteIds.includes(event.id) || !isNoteEvent(event)) continue;

      this.previous.push({
        id: event.id,
        duration: event.duration
      });

      event.duration = Math.max(
        this.minDuration,
        event.duration + this.deltaDuration
      );
    }
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId);

    for (const previous of this.previous) {
      const event = pattern.events.find((candidate) => candidate.id === previous.id);

      if (!event || !isNoteEvent(event)) continue;

      event.duration = previous.duration;
    }
  }
}