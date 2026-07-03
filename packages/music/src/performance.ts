import type { NoteEvent, NoteValue } from './note-event'

export function getEffectiveBeat(note: NoteEvent): number {
  return Math.max(0, note.time + getTimingOffset(note.value))
}

export function getEffectiveVelocity(note: NoteEvent): number {
  return clampUnit(note.value.velocity + getVelocityOffset(note.value))
}

export function getTimingOffset(value: NoteValue): number {
  return value.performance?.timingOffset ?? value.humanizeOffset ?? 0
}

export function setTimingOffset(
  value: NoteValue,
  offset: number,
  noteTime: number
): void {
  const nextOffset = clampTimingOffset(offset, noteTime)

  delete value.humanizeOffset

  if (nextOffset === 0) {
    clearPerformanceProperty(value, 'timingOffset')
    return
  }

  value.performance = {
    ...value.performance,
    timingOffset: nextOffset
  }
}

export function getVelocityOffset(value: NoteValue): number {
  return value.performance?.velocityOffset ?? 0
}

export function clearPerformance(value: NoteValue): void {
  delete value.humanizeOffset
  delete value.performance
}

export function clampTimingOffset(offset: number, noteTime: number): number {
  if (!Number.isFinite(offset)) return 0

  return Math.max(-noteTime, offset)
}

function clearPerformanceProperty(
  value: NoteValue,
  key: keyof NonNullable<NoteValue['performance']>
): void {
  if (!value.performance) return

  delete value.performance[key]

  if (Object.keys(value.performance).length === 0) {
    delete value.performance
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(1, Math.max(0, value))
}
