import type { Pattern } from '@sequencer/core'
import { getNoteTimingOffset, isNoteEvent } from './note-event'

export type PatternNoteView = {
  id: string
  time: number
  duration: number
  pitch: number
  velocity: number
  probability: number
  humanizeOffset: number
}

export type PatternEditorModel = {
  patternId: string
  patternName: string
  length: number
  notes: PatternNoteView[]
}

export function buildPatternEditorModel(pattern: Pattern): PatternEditorModel {
  return {
    patternId: pattern.id,
    patternName: pattern.name,
    length: pattern.length,
    notes: pattern.events.filter(isNoteEvent).map((event) => ({
      id: event.id,
      time: event.time,
      duration: event.duration,
      pitch: event.value.pitch,
      velocity: event.value.velocity,
      probability: event.value.probability ?? 1,
      humanizeOffset: getNoteTimingOffset(event.value)
    }))
  }
}
