import type {
  EntityId,
  Operation,
  SequencerDocument,
  TimelineEvent
} from '@sequencer/core'
import { isNoteEvent } from '../note-event'

type DeletedNoteState = {
  event: TimelineEvent
  index: number
}

export class DeleteNotesOperation implements Operation {
  readonly name = 'Delete Notes'

  private deleted: DeletedNoteState[] = []

  constructor(
    private readonly patternId: EntityId,
    private readonly noteIds: EntityId[]
  ) {}

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)
    this.deleted = []

    pattern.events.forEach((event, index) => {
      if (!this.noteIds.includes(event.id) || !isNoteEvent(event)) return

      this.deleted.push({
        event,
        index
      })
    })

    pattern.events = pattern.events.filter(
      (event) => !this.noteIds.includes(event.id)
    )
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    for (const deleted of [...this.deleted].sort((a, b) => a.index - b.index)) {
      pattern.events.splice(deleted.index, 0, deleted.event)
    }
  }
}
