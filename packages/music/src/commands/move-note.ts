import type {
  BeatTime,
  EntityId,
  Operation,
  SequencerDocument,
  TimelineEvent
} from '@sequencer/core'
import { getNote } from '../note-lookup'
import {
  resolveNoteCollisions,
  restoreEvents,
  snapshotEvents
} from './note-collisions'

export class MoveNoteOperation implements Operation {
  readonly name = 'Move Note'

  private previousEvents: TimelineEvent[] = []

  constructor(
    private readonly patternId: EntityId,
    private readonly noteId: EntityId,
    private readonly nextTime: BeatTime,
    private readonly nextPitch: number
  ) {}

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)
    const note = getNote(document, this.patternId, this.noteId)

    this.previousEvents = snapshotEvents(pattern.events)
    note.time = this.nextTime
    note.value.pitch = this.nextPitch
    pattern.events = resolveNoteCollisions(pattern.events, [this.noteId])
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    pattern.events = restoreEvents(this.previousEvents)
  }
}
