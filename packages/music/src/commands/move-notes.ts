import type {
  EntityId,
  Operation,
  SequencerDocument,
  TimelineEvent
} from '@sequencer/core'
import {
  isNoteEvent,
  type NoteValue
} from '../note-event'
import { getTimingOffset, setTimingOffset } from '../performance'
import {
  resolveNoteCollisions,
  restoreEvents,
  snapshotEvents
} from './note-collisions'

export type MoveNoteTarget = {
  id: EntityId
  time: number
  pitch: number
}

export class MoveNotesOperation implements Operation {
  readonly name = 'Move Notes'

  private previousEvents: TimelineEvent[] = []

  constructor(
    private readonly patternId: EntityId,
    private readonly noteIds: EntityId[],
    private readonly deltaBeat: number,
    private readonly deltaPitch: number,
    private readonly targets?: MoveNoteTarget[]
  ) {}

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    this.previousEvents = snapshotEvents(pattern.events)

    const targetById = new Map(this.targets?.map((target) => [target.id, target]))

    for (const event of pattern.events) {
      if (!this.noteIds.includes(event.id) || !isNoteEvent(event)) continue

      const target = targetById.get(event.id)

      event.time = target
        ? Math.max(0, target.time)
        : Math.max(0, event.time + this.deltaBeat)
      event.value.pitch = target ? target.pitch : event.value.pitch + this.deltaPitch
      clampHumanizeOffset(event.value, event.time)
    }

    pattern.events = resolveNoteCollisions(pattern.events, this.noteIds)
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    pattern.events = restoreEvents(this.previousEvents)
  }
}

function clampHumanizeOffset(value: NoteValue, noteTime: number): void {
  setTimingOffset(value, getTimingOffset(value), noteTime)
}
