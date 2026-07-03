import type {
  EntityId,
  Operation,
  SequencerDocument,
  TimelineEvent
} from '@sequencer/core';
import { isNoteEvent } from '../note-event';
import {
  resolveNoteCollisions,
  restoreEvents,
  snapshotEvents
} from './note-collisions';

export class ResizeNotesOperation implements Operation {
  readonly name = 'Resize Notes';

  private previousEvents: TimelineEvent[] = [];

  constructor(
    private readonly patternId: EntityId,
    private readonly noteIds: EntityId[],
    private readonly deltaDuration: number,
    private readonly minDuration = 0.25
  ) {}

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId);

    this.previousEvents = snapshotEvents(pattern.events);

    for (const event of pattern.events) {
      if (!this.noteIds.includes(event.id) || !isNoteEvent(event)) continue;

      event.duration = Math.max(
        this.minDuration,
        event.duration + this.deltaDuration
      );
    }

    pattern.events = resolveNoteCollisions(pattern.events, this.noteIds);
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId);

    pattern.events = restoreEvents(this.previousEvents);
  }
}
