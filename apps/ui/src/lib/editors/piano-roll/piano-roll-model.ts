import type { Pattern } from '@sequencer/core'
import { buildPatternEditorModel } from '@sequencer/music'

const LOWEST_MIDI_PITCH = 0
const HIGHEST_MIDI_PITCH = 127

export type PianoRollNoteView = {
  id: string
  patternId: string
  time: number
  duration: number
  pitch: number
  velocity: number
  probability: number
  humanizeOffset: number
}

export type PianoRollView = {
  patternId: string
  patternName: string
  length: number
  pitchRows: number[]
  lowestPitch: number
  highestPitch: number
  pitchCount: number
  notes: PianoRollNoteView[]
}

export function buildPianoRollView(pattern: Pattern): PianoRollView {
  const model = buildPatternEditorModel(pattern)

  return {
    patternId: model.patternId,
    patternName: model.patternName,
    length: model.length,
    pitchRows: buildPitchRows(LOWEST_MIDI_PITCH, HIGHEST_MIDI_PITCH),
    lowestPitch: LOWEST_MIDI_PITCH,
    highestPitch: HIGHEST_MIDI_PITCH,
    pitchCount: HIGHEST_MIDI_PITCH - LOWEST_MIDI_PITCH + 1,
    notes: model.notes.map((note) => ({
      ...note,
      patternId: model.patternId
    }))
  }
}

function buildPitchRows(lowestPitch: number, highestPitch: number): number[] {
  return Array.from(
    { length: highestPitch - lowestPitch + 1 },
    (_, index) => highestPitch - index
  )
}
