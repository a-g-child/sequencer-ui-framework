import type {
  EntityId,
  Operation,
  SequencerDocument
} from '@sequencer/core'
import { getNote } from '../note-lookup'

export class SetNoteVelocityOperation implements Operation {
  readonly name = 'Set Note Velocity'

  private previousVelocity?: number

  constructor(
    private readonly patternId: EntityId,
    private readonly noteId: EntityId,
    private readonly nextVelocity: number
  ) {}

  execute(document: SequencerDocument): void {
    const note = getNote(document, this.patternId, this.noteId)

    this.previousVelocity = note.value.velocity
    note.value.velocity = clampVelocity(this.nextVelocity)
  }

  undo(document: SequencerDocument): void {
    if (this.previousVelocity === undefined) return

    const note = getNote(document, this.patternId, this.noteId)
    note.value.velocity = this.previousVelocity
  }
}

function clampVelocity(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(1, Math.max(0, value))
}
