import type { BeatTime, TimelineEvent } from '@sequencer/core'

export interface NoteValue {
  pitch: number
  velocity: number
  probability?: number
  performance?: NotePerformance
  /**
   * Legacy timing modifier. New code should use performance.timingOffset via
   * the helpers below so older documents remain readable.
   */
  humanizeOffset?: number
}

export interface NotePerformance {
  timingOffset?: number
  velocityOffset?: number
  probability?: number
  articulation?: number
}

export interface NoteEvent extends TimelineEvent<NoteValue> {
  type: 'trigger'
  duration: BeatTime
  value: NoteValue
}

export function isNoteEvent(event: TimelineEvent): event is NoteEvent {
  return (
    event.type === 'trigger' &&
    typeof event.duration === 'number' &&
    typeof event.value === 'object' &&
    event.value !== null &&
    'pitch' in event.value &&
    'velocity' in event.value &&
    typeof event.value.pitch === 'number' &&
    typeof event.value.velocity === 'number'
  )
}

export function getNoteTimingOffset(value: NoteValue): number {
  return value.performance?.timingOffset ?? value.humanizeOffset ?? 0
}

export function setNoteTimingOffset(
  value: NoteValue,
  offset: number,
  noteTime: number
): void {
  const nextOffset = clampNoteTimingOffset(offset, noteTime)

  delete value.humanizeOffset

  if (nextOffset === 0) {
    clearEmptyPerformanceValue(value)
    return
  }

  value.performance = {
    ...value.performance,
    timingOffset: nextOffset
  }
}

export function clampNoteTimingOffset(
  offset: number,
  noteTime: number
): number {
  if (!Number.isFinite(offset)) return 0

  return Math.max(-noteTime, offset)
}

function clearEmptyPerformanceValue(value: NoteValue): void {
  if (!value.performance) return

  delete value.performance.timingOffset

  if (Object.keys(value.performance).length === 0) {
    delete value.performance
  }
}
