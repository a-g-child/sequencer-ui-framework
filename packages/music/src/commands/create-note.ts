import {
  createId,
  type BeatTime,
  type EntityId,
  type Operation,
  type SequencerDocument,
  type TimelineEvent
} from '@sequencer/core'
import type { NoteEvent } from '../note-event'
import { setTimingOffset } from '../performance'
import {
  resolveNoteCollisions,
  restoreEvents,
  snapshotEvents
} from './note-collisions'

export class CreateNoteOperation implements Operation {
  readonly name = 'Create Note'
  readonly note: NoteEvent
  private previousEvents: TimelineEvent[] = []

  constructor(
    private readonly patternId: EntityId,
    time: BeatTime,
    duration: BeatTime,
    pitch: number,
    velocity = 0.8,
    probability = 1,
    humanizeOffset = 0
  ) {
    this.note = {
      id: createId('note'),
      time,
      duration,
      type: 'trigger',
      value: { pitch, velocity, probability }
    }

    setTimingOffset(this.note.value, humanizeOffset, time)
  }

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    this.previousEvents = snapshotEvents(pattern.events)
    pattern.events.push(this.note)
    pattern.events = resolveNoteCollisions(pattern.events, [this.note.id])
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    pattern.events = restoreEvents(this.previousEvents)
  }
}
