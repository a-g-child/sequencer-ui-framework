import {
  createId,
  type BeatTime,
  type EntityId,
  type Operation,
  type SequencerDocument
} from '@sequencer/core'
import type { NoteEvent } from '../note-event'

export class CreateNoteOperation implements Operation {
  readonly name = 'Create Note'
  readonly note: NoteEvent

  constructor(
    private readonly patternId: EntityId,
    time: BeatTime,
    duration: BeatTime,
    pitch: number,
    velocity = 0.8
  ) {
    this.note = {
      id: createId('note'),
      time,
      duration,
      type: 'trigger',
      value: { pitch, velocity }
    }
  }

  execute(document: SequencerDocument): void {
    document.patterns.get(this.patternId).events.push(this.note)
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)
    pattern.events = pattern.events.filter((event) => event.id !== this.note.id)
  }
}
