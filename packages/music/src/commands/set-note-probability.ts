import type {
  EntityId,
  Operation,
  SequencerDocument
} from '@sequencer/core'
import { getNote } from '../note-lookup.ts'

export class SetNoteProbabilityOperation implements Operation {
  readonly name = 'Set Note Probability'

  private previousProbability?: number

  constructor(
    private readonly patternId: EntityId,
    private readonly noteId: EntityId,
    private readonly nextProbability: number
  ) {}

  execute(document: SequencerDocument): void {
    const note = getNote(document, this.patternId, this.noteId)

    this.previousProbability = note.value.probability
    note.value.probability = clampProbability(this.nextProbability)
  }

  undo(document: SequencerDocument): void {
    const note = getNote(document, this.patternId, this.noteId)

    if (this.previousProbability === undefined) {
      delete note.value.probability
      return
    }

    note.value.probability = this.previousProbability
  }
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(1, Math.max(0, value))
}
