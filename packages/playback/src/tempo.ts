import type { BeatTime } from '@sequencer/core'
import type { TempoMap } from './model.ts'

export function beatToMs(beat: BeatTime, tempoMap: TempoMap): number {
  const bpm = getTempoAtBeat(beat, tempoMap)

  return (beat * 60_000) / bpm
}

export function msToBeat(timeMs: number, tempoMap: TempoMap): BeatTime {
  const bpm = getTempoAtBeat(0, tempoMap)

  return (timeMs * bpm) / 60_000
}

export function beatsToMs(beats: BeatTime, tempoMap: TempoMap): number {
  const bpm = getTempoAtBeat(0, tempoMap)

  return (beats * 60_000) / bpm
}

export function msToBeats(timeMs: number, tempoMap: TempoMap): BeatTime {
  const bpm = getTempoAtBeat(0, tempoMap)

  return (timeMs * bpm) / 60_000
}

export function getTempoAtBeat(beat: BeatTime, tempoMap: TempoMap): number {
  const sortedChanges = [...tempoMap.changes].sort((a, b) => a.beat - b.beat)
  let bpm = tempoMap.defaultBpm

  for (const change of sortedChanges) {
    if (change.beat > beat) break
    bpm = change.bpm
  }

  return bpm
}
