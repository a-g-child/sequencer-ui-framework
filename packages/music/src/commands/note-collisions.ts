import type { EntityId, TimelineEvent } from '@sequencer/core'
import { isNoteEvent, type NoteEvent } from '../note-event'

const beatEpsilon = 1e-9

export function snapshotEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.map(cloneEvent)
}

export function restoreEvents(snapshot: TimelineEvent[]): TimelineEvent[] {
  return snapshotEvents(snapshot)
}

export function resolveNoteCollisions(
  events: TimelineEvent[],
  primaryNoteIds: EntityId[]
): TimelineEvent[] {
  const primaryIdSet = new Set(primaryNoteIds)
  const removedIds = new Set<EntityId>()
  const primaryNotes = events
    .filter((event): event is NoteEvent =>
      primaryIdSet.has(event.id) && isNoteEvent(event)
    )
    .sort(compareNotes)

  for (const primary of primaryNotes) {
    if (removedIds.has(primary.id)) continue

    const primaryEnd = noteEnd(primary)

    for (const event of events) {
      if (
        event.id === primary.id ||
        removedIds.has(event.id) ||
        !isNoteEvent(event) ||
        event.value.pitch !== primary.value.pitch
      ) {
        continue
      }

      if (sameBeat(event.time, primary.time)) {
        removedIds.add(event.id)
        continue
      }

      if (event.time < primary.time && noteEnd(event) > primary.time + beatEpsilon) {
        event.duration = Math.max(0, primary.time - event.time)

        if (event.duration <= beatEpsilon) {
          removedIds.add(event.id)
        }

        continue
      }

      if (
        event.time > primary.time + beatEpsilon &&
        event.time < primaryEnd - beatEpsilon
      ) {
        removedIds.add(event.id)
      }
    }
  }

  return events.filter((event) => !removedIds.has(event.id))
}

function cloneEvent(event: TimelineEvent): TimelineEvent {
  return {
    ...event,
    value: cloneValue(event.value)
  }
}

function cloneValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value

  if (Array.isArray(value)) return [...value]

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])
  )
}

function noteEnd(note: NoteEvent): number {
  return note.time + note.duration
}

function sameBeat(left: number, right: number): boolean {
  return Math.abs(left - right) <= beatEpsilon
}

function compareNotes(left: NoteEvent, right: NoteEvent): number {
  if (left.value.pitch !== right.value.pitch) {
    return left.value.pitch - right.value.pitch
  }

  if (!sameBeat(left.time, right.time)) {
    return left.time - right.time
  }

  return left.id.localeCompare(right.id)
}
