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

export type TimelineTrackView = {
  id: string
  name: string
  placementCount: number
  placements: TimelinePlacementView[]
}

export type TimelineView = {
  length: BeatTime
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

  return {
    length: calculateTimelineLength(
      tracks.flatMap((track) => track.placements)
    ),
    tracks
  }
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
