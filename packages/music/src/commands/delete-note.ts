import type {
  EntityId,
  Operation,
  SequencerDocument,
  TimelineEvent
} from '@sequencer/core'

export class DeleteNoteOperation implements Operation {
  readonly name = 'Delete Note'

  private deleted?: TimelineEvent
  private index = -1

  constructor(
    private readonly patternId: EntityId,
    private readonly noteId: EntityId
  ) {}

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    this.index = pattern.events.findIndex((event) => event.id === this.noteId)
    if (this.index < 0) return

    this.deleted = pattern.events[this.index]
    pattern.events.splice(this.index, 1)
  }

  undo(document: SequencerDocument): void {
    if (!this.deleted || this.index < 0) return

    const pattern = document.patterns.get(this.patternId)
    pattern.events.splice(this.index, 0, this.deleted)
  }
}
