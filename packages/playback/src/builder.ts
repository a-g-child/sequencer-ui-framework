import type { SequencerDocument } from '@sequencer/core'
import { getEffectiveBeat, getEffectiveVelocity, isNoteEvent } from '@sequencer/music'
import { freezePlaybackModel, type PlaybackClip, type PlaybackModel, type PlaybackNote, type PlaybackTrack } from './model'

export class PlaybackModelBuilder {
  build(document: SequencerDocument, bpm = document.bpm): PlaybackModel {
    const tracks: PlaybackTrack[] = []
    const clips: PlaybackClip[] = []
    const notes: PlaybackNote[] = []

    document.tracks.values().forEach((track, trackIndex) => {
      const playbackTrack: PlaybackTrack = {
        id: track.id,
        name: track.name,
        channel: trackIndex % 16,
        target: track.target
      }
      tracks.push(playbackTrack)

      for (const placement of track.placements) {
        const pattern = document.patterns.find(placement.target)

        if (!pattern) continue

        const loopCount = Math.max(1, Math.floor(placement.loopCount ?? 1))
        const clipLength = placement.length ?? pattern.length

        for (let loopIndex = 0; loopIndex < loopCount; loopIndex += 1) {
          const clipStart = placement.start + loopIndex * clipLength
          const clip: PlaybackClip = {
            id: `${placement.id}:loop-${loopIndex}`,
            trackId: track.id,
            patternId: pattern.id,
            name: placement.name,
            start: clipStart,
            length: clipLength,
            sourceStart: 0,
            sourceLength: pattern.length,
            loopIndex
          }
          clips.push(clip)

          for (const event of pattern.events) {
            if (!isNoteEvent(event)) continue

            const effectiveBeat = getEffectiveBeat(event)
            if (effectiveBeat >= pattern.length || effectiveBeat >= clipLength) {
              continue
            }

            const beat = clipStart + effectiveBeat
            const duration = Math.max(0, Math.min(event.duration, clipLength - effectiveBeat))

            notes.push({
              id: `${clip.id}:${event.id}`,
              sourceNoteId: event.id,
              trackId: track.id,
              clipId: clip.id,
              patternId: pattern.id,
              pitch: event.value.pitch,
              velocity: getEffectiveVelocity(event),
              beat,
              duration
            })
          }
        }
      }
    })

    notes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
    clips.sort((a, b) => a.start - b.start)

    return freezePlaybackModel({
      id: `playback-${document.id}-${Date.now()}`,
      createdAt: Date.now(),
      length: document.timeline.length,
      tempoMap: {
        defaultBpm: bpm,
        changes: [{ beat: 0, bpm }]
      },
      tracks,
      clips,
      notes
    })
  }
}
