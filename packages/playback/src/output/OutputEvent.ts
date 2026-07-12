import type { PlaybackEvent } from '../events.ts'

export interface OutputCapabilities {
  readonly noteEvents: boolean
  readonly controlEvents: boolean
  readonly automation: boolean
  readonly clock: boolean
  readonly transport: boolean
}

export interface OutputEvent {
  readonly type:
    | 'output:registered'
    | 'output:removed'
    | 'output:connected'
    | 'output:disconnected'
    | 'output:events'
  readonly outputId?: string
  readonly events?: readonly PlaybackEvent[]
}

export type OutputEventListener = (event: OutputEvent) => void

export const noteOnlyCapabilities: OutputCapabilities = {
  noteEvents: true,
  controlEvents: false,
  automation: false,
  clock: false,
  transport: false
}

export const observationCapabilities: OutputCapabilities = {
  noteEvents: true,
  controlEvents: true,
  automation: true,
  clock: true,
  transport: true
}
