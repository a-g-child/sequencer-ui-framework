import type { PlaybackEvent } from '../events.ts'

export function midiMessagesForPlaybackEvent(
  event: PlaybackEvent
): readonly number[][] {
  if (event.type === 'note:on') {
    return [[0x90 + (event.channel ?? 0), event.pitch, velocityToMidi(event.velocity)]]
  }

  if (event.type === 'note:off') {
    return [[0x80 + (event.channel ?? 0), event.pitch, 0]]
  }

  if (event.type === 'automation:set') {
    const message = automationToMidi(event.parameterKey, event.value, event.channel ?? 0)

    return message ? [message] : []
  }

  return []
}

function velocityToMidi(velocity: number): number {
  if (!Number.isFinite(velocity)) return 0

  return Math.round(Math.min(1, Math.max(0, velocity)) * 127)
}

function automationToMidi(
  parameterKey: string | undefined,
  value: number,
  channel: number
): number[] | undefined {
  if (parameterKey === 'track.volume') {
    return [0xb0 + channel, 7, unitToMidi(value)]
  }

  if (parameterKey === 'track.pan') {
    return [0xb0 + channel, 10, bipolarToMidi(value)]
  }

  return undefined
}

function unitToMidi(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.round(Math.min(1, Math.max(0, value)) * 127)
}

function bipolarToMidi(value: number): number {
  if (!Number.isFinite(value)) return 64

  return Math.round(((Math.min(1, Math.max(-1, value)) + 1) / 2) * 127)
}
