import type {
  EntityId,
  Operation,
  SequencerDocument
} from '@sequencer/core'
import { isNoteEvent } from '../note-event'

type PreviousNoteState = {
  id: EntityId
  time: number
  pitch: number
}

export class MoveNotesOperation implements Operation {
  readonly name = 'Move Notes'

  private previous: PreviousNoteState[] = []

  constructor(
    private readonly patternId: EntityId,
    private readonly noteIds: EntityId[],
    private readonly deltaBeat: number,
    private readonly deltaPitch: number
  ) {}

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)
    this.previous = []

    for (const event of pattern.events) {
      if (!this.noteIds.includes(event.id) || !isNoteEvent(event)) continue

      this.previous.push({
        id: event.id,
        time: event.time,
        pitch: event.value.pitch
      })

      event.time = Math.max(0, event.time + this.deltaBeat)
      event.value.pitch = event.value.pitch + this.deltaPitch
    }
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    for (const previous of this.previous) {
      const event = pattern.events.find(
        (candidate) => candidate.id === previous.id
      )

      if (!event || !isNoteEvent(event)) continue

      event.time = previous.time
      event.value.pitch = previous.pitch
    }
  }
}
