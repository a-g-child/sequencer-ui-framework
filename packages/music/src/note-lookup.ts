import type {
  EntityId,
  SequencerDocument,
  TimelineEvent
} from '@sequencer/core'
import { isNoteEvent, type NoteEvent } from './note-event'

export function getNote(
  document: SequencerDocument,
  patternId: EntityId,
  noteId: EntityId
): NoteEvent {
  const event = document.patterns
    .get(patternId)
    .events.find((item) => item.id === noteId)

  if (!event || !isNoteEvent(event)) {
    throw new Error(`Note not found: ${noteId}`)
  }

  return event
}

export function replaceNoteEvent(
  events: TimelineEvent[],
  note: NoteEvent
): TimelineEvent[] {
  return events.map((event) => (event.id === note.id ? note : event))
}
