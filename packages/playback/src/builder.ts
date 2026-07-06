import type { SequencerDocument, TimelineEvent } from '@sequencer/core'
import { getEffectiveBeat, getEffectiveVelocity, isNoteEvent } from '@sequencer/music'
import { freezePlaybackModel, type PlaybackAutomation, type PlaybackClip, type PlaybackModel, type PlaybackNote, type PlaybackTrack } from './model'

export class PlaybackModelBuilder {
  build(document: SequencerDocument, bpm = document.bpm): PlaybackModel {
    const tracks: PlaybackTrack[] = []
    const clips: PlaybackClip[] = []
    const notes: PlaybackNote[] = []
    const automations: PlaybackAutomation[] = []

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

        const clipLength = placement.length ?? pattern.length
        const loop = placement.loop ?? true
        const loopStart = clampLoopStart(placement.loopStart ?? 0, clipLength)
        const loopLength = clampLoopLength(
          placement.loopLength ?? clipLength,
          loopStart,
          clipLength
        )
        const loopCount = loop ? 1 : Math.max(1, Math.floor(placement.loopCount ?? 1))

        for (let loopIndex = 0; loopIndex < loopCount; loopIndex += 1) {
          const clipStart = placement.start + loopIndex * clipLength
          const clip: PlaybackClip = {
            id: `${placement.id}:loop-${loopIndex}`,
            trackId: track.id,
            patternId: pattern.id,
            name: placement.name,
            start: clipStart,
            length: clipLength,
            loop,
            loopStart,
            loopLength,
            sourceStart: 0,
            sourceLength: pattern.length,
            loopIndex
          }
          clips.push(clip)

          for (const event of pattern.events) {
            if (isNoteEvent(event)) {
              const effectiveBeat = getEffectiveBeat(event)
              if (effectiveBeat >= pattern.length || effectiveBeat >= clipLength) {
                continue
              }

              const beat = clipStart + effectiveBeat
              const maximumDuration =
                loop && effectiveBeat >= loopStart && effectiveBeat < loopStart + loopLength
                  ? loopStart + loopLength - effectiveBeat
                  : clipLength - effectiveBeat
              const duration = Math.max(0, Math.min(event.duration, maximumDuration))

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
              continue
            }

            if (!isAutomationEvent(event)) continue

            if (event.time >= pattern.length || event.time >= clipLength) {
              continue
            }

            const parameter = document.parameters.find(event.target)
            const definition = parameter
              ? document.parameterDefinitions.find(parameter.definitionId)
              : undefined

            automations.push({
              id: `${clip.id}:${event.id}`,
              sourceEventId: event.id,
              trackId: track.id,
              clipId: clip.id,
              patternId: pattern.id,
              parameterId: event.target,
              parameterKey: definition?.key,
              value: event.value,
              beat: clipStart + event.time
            })
          }
        }
      }
    })

    notes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
    automations.sort((a, b) => a.beat - b.beat || a.parameterId.localeCompare(b.parameterId))
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
      notes,
      automations
    })
  }
}

function isAutomationEvent(
  event: TimelineEvent
): event is TimelineEvent<number> & { target: string } {
  return (
    (event.type === 'set' || event.type === 'ramp') &&
    typeof event.target === 'string' &&
    typeof event.value === 'number'
  )
}

function clampLoopStart(loopStart: number, clipLength: number): number {
  if (!Number.isFinite(loopStart)) return 0

  return Math.min(Math.max(0, loopStart), Math.max(0, clipLength))
}

function clampLoopLength(
  loopLength: number,
  loopStart: number,
  clipLength: number
): number {
  const maximumLength = Math.max(0.25, clipLength - loopStart)

  if (!Number.isFinite(loopLength)) return maximumLength

  return Math.min(Math.max(0.25, loopLength), maximumLength)
}
