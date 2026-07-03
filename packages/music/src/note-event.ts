import type { BeatTime, TimelineEvent } from '@sequencer/core'

export interface NoteValue {
  pitch: number
  velocity: number
  probability?: number
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
