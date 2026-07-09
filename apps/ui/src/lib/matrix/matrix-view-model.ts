import type { Track } from '@sequencer/core'
import type { TrackClipView } from '../app-controller'

export type MatrixClipView = TrackClipView & {
  readonly playbackProgress: number | undefined
  readonly queuedProgress: number | undefined
}

export type MatrixTrackView = {
  readonly track: Track
  readonly clips: MatrixClipView[]
  readonly queuedLaunch: string
}

export type MatrixSceneRow = {
  readonly slotIndex: number
  readonly label: string
  readonly hasClips: boolean
  readonly playing: boolean
  readonly queued: boolean
}
