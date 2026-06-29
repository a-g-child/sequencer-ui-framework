import type {
  BeatTime,
  EntityId,
  Operation,
  SequencerDocument
} from '@sequencer/core'
import { getNote } from '../note-lookup'

export class MoveNoteOperation implements Operation {
  readonly name = 'Move Note'

  private previousTime?: BeatTime
  private previousPitch?: number

  constructor(
    private readonly patternId: EntityId,
    private readonly noteId: EntityId,
    private readonly nextTime: BeatTime,
    private readonly nextPitch: number
  ) {}

  execute(document: SequencerDocument): void {
    const note = getNote(document, this.patternId, this.noteId)

    this.previousTime = note.time
    this.previousPitch = note.value.pitch
    note.time = this.nextTime
    note.value.pitch = this.nextPitch
  }

  undo(document: SequencerDocument): void {
    if (this.previousTime === undefined || this.previousPitch === undefined) {
      return
    }

    const note = getNote(document, this.patternId, this.noteId)
    note.time = this.previousTime
    note.value.pitch = this.previousPitch
  }
}
