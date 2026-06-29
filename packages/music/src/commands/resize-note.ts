import type {
  BeatTime,
  EntityId,
  Operation,
  SequencerDocument
} from '@sequencer/core'
import { getNote } from '../note-lookup'

export class ResizeNoteOperation implements Operation {
  readonly name = 'Resize Note'

  private previousDuration?: BeatTime

  constructor(
    private readonly patternId: EntityId,
    private readonly noteId: EntityId,
    private readonly nextDuration: BeatTime
  ) {}

  execute(document: SequencerDocument): void {
    const note = getNote(document, this.patternId, this.noteId)

    this.previousDuration = note.duration
    note.duration = this.nextDuration
  }

  undo(document: SequencerDocument): void {
    if (this.previousDuration === undefined) return

    const note = getNote(document, this.patternId, this.noteId)
    note.duration = this.previousDuration
  }
}
