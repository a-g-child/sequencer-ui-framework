import type { BeatTime, TimelineEvent } from '@sequencer/core'

export interface NoteValue {
  /**
   * Note value describes musical intent. Note performance describes
   * interpretation modifiers applied at render/playback time.
   */
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
