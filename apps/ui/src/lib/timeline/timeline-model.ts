import type { BeatTime, DocumentStore } from '@sequencer/core'

export type TimelinePlacementView = {
  id: string
  trackId: string
  trackName: string
  patternId: string
  patternName: string
  start: number
  length: number
}

export type TimelineMarkerView = {
  id: string
  label: string
  position: number
}

export type TimelineLineView = {
  id: string
  position: number
  isBeat: boolean
}

export type TimelineTrackView = {
  id: string
  name: string
  placementCount: number
  placements: TimelinePlacementView[]
}

export type TimelineView = {
  length: BeatTime
  beatMarkers: TimelineMarkerView[]
  subdivisionLines: TimelineLineView[]
  tracks: TimelineTrackView[]
}

export function buildTimelineView(store: DocumentStore): TimelineView {
  const tracks = store.document.tracks.values().map((track) => {
    const placements = track.placements.map((placement) => {
      const pattern = store.document.patterns.get(placement.target)

      return {
        id: placement.id,
        trackId: track.id,
        trackName: track.name,
        patternId: pattern.id,
        patternName: pattern.name,
        start: placement.start,
        length: placement.length ?? pattern.length
      }
    })

    return {
      id: track.id,
      name: track.name,
      placementCount: placements.length,
      placements
    }
  })

  const length = calculateTimelineLength(
    tracks.flatMap((track) => track.placements)
  )

  return {
    length,
    beatMarkers: buildBeatMarkers(length),
    subdivisionLines: buildSubdivisionLines(length),
    tracks
  }
}

function buildBeatMarkers(length: BeatTime): TimelineMarkerView[] {
  return Array.from({ length: Math.floor(length) + 1 }, (_, beat) => ({
    id: `timeline-beat-${beat}`,
    label: String(beat),
    position: (beat / length) * 100
  }))
}

function buildSubdivisionLines(length: BeatTime): TimelineLineView[] {
  const stepCount = Math.floor(length * 4)

  return Array.from({ length: stepCount + 1 }, (_, step) => ({
    id: `timeline-sixteenth-${step}`,
    position: (step / stepCount) * 100,
    isBeat: step % 4 === 0
  }))
}

function calculateTimelineLength(
  placements: TimelinePlacementView[]
): BeatTime {
  const lastBeat = placements.reduce(
    (maximum, placement) =>
      Math.max(maximum, placement.start + placement.length),
    0
  )

  return Math.max(16, Math.ceil(lastBeat + 4))
}
