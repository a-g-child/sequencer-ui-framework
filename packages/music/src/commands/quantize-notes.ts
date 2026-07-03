import type {
  EntityId,
  Operation,
  SequencerDocument,
  TimelineEvent
} from '@sequencer/core'
import { isNoteEvent } from '../note-event'
import {
  resolveNoteCollisions,
  restoreEvents,
  snapshotEvents
} from './note-collisions'

export class QuantizeNotesOperation implements Operation {
  readonly name = 'Quantise Notes'

  private previousEvents: TimelineEvent[] = []

  constructor(
    private readonly patternId: EntityId,
    private readonly noteIds: EntityId[],
    private readonly division: number
  ) {}

  execute(document: SequencerDocument): void {
    if (!Number.isFinite(this.division) || this.division <= 0) return

    const pattern = document.patterns.get(this.patternId)
    const noteIdSet = new Set(this.noteIds)

    this.previousEvents = snapshotEvents(pattern.events)

    for (const event of pattern.events) {
      if (!noteIdSet.has(event.id) || !isNoteEvent(event)) continue

      const effectiveTime = event.time + (event.value.humanizeOffset ?? 0)
      event.time = Math.max(0, quantizeBeat(effectiveTime, this.division))
      delete event.value.humanizeOffset
    }

    pattern.events = resolveNoteCollisions(pattern.events, this.noteIds)
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    pattern.events = restoreEvents(this.previousEvents)
  }
}

function quantizeBeat(beat: number, division: number): number {
  return Math.round(beat / division) * division
}
