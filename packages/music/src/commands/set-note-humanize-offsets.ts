import type {
  EntityId,
  Operation,
  SequencerDocument
} from '@sequencer/core'
import { isNoteEvent } from '../note-event'
import {
  clampTimingOffset,
  getTimingOffset,
  setTimingOffset
} from '../performance'

export type NoteHumanizeOffsetInput = {
  id: EntityId
  offset: number
}

type PreviousHumanizeOffset = {
  id: EntityId
  offset?: number
}

export class SetNoteHumanizeOffsetsOperation implements Operation {
  readonly name = 'Set Note Humanise Offsets'

  private previous: PreviousHumanizeOffset[] = []

  constructor(
    private readonly patternId: EntityId,
    private readonly offsets: NoteHumanizeOffsetInput[]
  ) {}

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)
    const offsetById = new Map(
      this.offsets.map((offset) => [offset.id, offset.offset])
    )

    this.previous = []

    for (const event of pattern.events) {
      if (!isNoteEvent(event) || !offsetById.has(event.id)) continue

      this.previous.push({
        id: event.id,
        offset: getTimingOffset(event.value)
      })

      const nextOffset = clampHumanizeOffset(
        offsetById.get(event.id) ?? 0,
        event.time
      )

      setTimingOffset(event.value, nextOffset, event.time)
    }
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)
    const previousById = new Map(
      this.previous.map((previous) => [previous.id, previous.offset])
    )

    for (const event of pattern.events) {
      if (!isNoteEvent(event) || !previousById.has(event.id)) continue

      const previousOffset = previousById.get(event.id)

      setTimingOffset(event.value, previousOffset ?? 0, event.time)
    }
  }
}

function clampHumanizeOffset(offset: number, noteTime: number): number {
  return clampTimingOffset(offset, noteTime)
}
