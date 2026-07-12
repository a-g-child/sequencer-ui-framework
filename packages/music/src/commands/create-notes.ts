import {
  createId,
  type BeatTime,
  type EntityId,
  type Operation,
  type SequencerDocument,
  type TimelineEvent
} from '@sequencer/core'
import type { NoteEvent } from '../note-event.ts'
import { setTimingOffset } from '../performance.ts'
import {
  resolveNoteCollisions,
  restoreEvents,
  snapshotEvents
} from './note-collisions.ts'

export type CreateNoteInput = {
  time: BeatTime
  duration: BeatTime
  pitch: number
  velocity: number
  probability?: number
  humanizeOffset?: number
}

export class CreateNotesOperation implements Operation {
  readonly name = 'Create Notes'
  readonly notes: NoteEvent[]
  private previousEvents: TimelineEvent[] = []

  constructor(
    private readonly patternId: EntityId,
    notes: CreateNoteInput[]
  ) {
    this.notes = notes.map((note) => {
      const event: NoteEvent = {
        id: createId('note'),
        time: note.time,
        duration: note.duration,
        type: 'trigger',
        value: {
          pitch: note.pitch,
          velocity: note.velocity,
          probability: note.probability ?? 1
        }
      }

      setTimingOffset(event.value, note.humanizeOffset ?? 0, note.time)

      return event
    })
  }

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    this.previousEvents = snapshotEvents(pattern.events)
    pattern.events.push(...this.notes)
    pattern.events = resolveNoteCollisions(
      pattern.events,
      this.notes.map((note) => note.id)
    )
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    pattern.events = restoreEvents(this.previousEvents)
  }
}
