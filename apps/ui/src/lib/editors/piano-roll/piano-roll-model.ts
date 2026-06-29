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
}

export type PianoRollMarkerView = {
  id: string
  label: string
  position: number
}

export type PianoRollLineView = {
  id: string
  position: number
  isBeat: boolean
}

export type PianoRollView = {
  patternId: string
  patternName: string
  length: number
  beats: number[]
  beatMarkers: PianoRollMarkerView[]
  subdivisionLines: PianoRollLineView[]
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
    beats: Array.from({ length: Math.floor(model.length) + 1 }, (_, beat) => beat),
    beatMarkers: buildBeatMarkers(model.length),
    subdivisionLines: buildSubdivisionLines(model.length),
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

function buildBeatMarkers(length: number): PianoRollMarkerView[] {
  return Array.from({ length: Math.floor(length) + 1 }, (_, beat) => ({
    id: `beat-${beat}`,
    label: String(beat),
    position: (beat / length) * 100
  }))
}

function buildSubdivisionLines(length: number): PianoRollLineView[] {
  const stepCount = Math.floor(length * 4)

  return Array.from({ length: stepCount + 1 }, (_, step) => ({
    id: `sixteenth-${step}`,
    position: (step / stepCount) * 100,
    isBeat: step % 4 === 0
  }))
}

function buildPitchRows(lowestPitch: number, highestPitch: number): number[] {
  return Array.from(
    { length: highestPitch - lowestPitch + 1 },
    (_, index) => highestPitch - index
  )
}
