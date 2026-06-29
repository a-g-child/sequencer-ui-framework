import type { Pattern } from '@sequencer/core'
import { buildPatternEditorModel } from '@sequencer/music'

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
  const pitches = model.notes.map((note) => note.pitch)
  const lowestNote = Math.min(60, ...pitches)
  const highestNote = Math.max(60, ...pitches)
  const pitchRange = calculatePitchRange(lowestNote, highestNote)

  return {
    patternId: model.patternId,
    patternName: model.patternName,
    length: model.length,
    beats: Array.from({ length: Math.floor(model.length) + 1 }, (_, beat) => beat),
    beatMarkers: buildBeatMarkers(model.length),
    subdivisionLines: buildSubdivisionLines(model.length),
    pitchRows: buildPitchRows(pitchRange.lowestPitch, pitchRange.highestPitch),
    lowestPitch: pitchRange.lowestPitch,
    highestPitch: pitchRange.highestPitch,
    pitchCount: pitchRange.highestPitch - pitchRange.lowestPitch + 1,
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

function calculatePitchRange(
  lowestNote: number,
  highestNote: number
): { lowestPitch: number; highestPitch: number } {
  let lowestPitch = Math.max(0, lowestNote - 6)
  let highestPitch = Math.min(127, highestNote + 6)

  while (highestPitch - lowestPitch + 1 < 24) {
    if (lowestPitch > 0) {
      lowestPitch--
    }

    if (highestPitch < 127) {
      highestPitch++
    }

    if (lowestPitch === 0 && highestPitch === 127) break
  }

  return { lowestPitch, highestPitch }
}
