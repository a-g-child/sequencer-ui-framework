import {
  createId,
  type BeatTime,
  type EntityId,
  type Operation,
  type SequencerDocument
} from '@sequencer/core'
import type { NoteEvent } from '../note-event'

export type CreateNoteInput = {
  time: BeatTime
  duration: BeatTime
  pitch: number
  velocity: number
}

export class CreateNotesOperation implements Operation {
  readonly name = 'Create Notes'
  readonly notes: NoteEvent[]

  constructor(
    private readonly patternId: EntityId,
    notes: CreateNoteInput[]
  ) {
    this.notes = notes.map((note) => ({
      id: createId('note'),
      time: note.time,
      duration: note.duration,
      type: 'trigger',
      value: {
        pitch: note.pitch,
        velocity: note.velocity
      }
    }))
  }

  execute(document: SequencerDocument): void {
    document.patterns.get(this.patternId).events.push(...this.notes)
  }

  undo(document: SequencerDocument): void {
    const noteIds = new Set(this.notes.map((note) => note.id))
    const pattern = document.patterns.get(this.patternId)

    pattern.events = pattern.events.filter((event) => !noteIds.has(event.id))
  }
}
