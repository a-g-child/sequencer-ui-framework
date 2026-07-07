import type { BeatTime, EntityId } from '@sequencer/core'
import type { ClockState } from './clock'

export type ClipLaunchQuantize = 'none' | 'beat' | 'bar' | '2-bars' | '4-bars'

export interface ActiveClipLaunch {
  readonly trackId: EntityId
  readonly clipId: EntityId
  readonly launchedAtBeat: BeatTime
}

export interface PendingClipLaunch {
  readonly trackId: EntityId
  readonly clipId: EntityId
  readonly requestedAtBeat: BeatTime
  readonly launchAtBeat: BeatTime
}

export interface AppliedClipLaunch {
  readonly trackId: EntityId
  readonly clipId: EntityId
  readonly previousClipId?: EntityId
  readonly launchAtBeat: BeatTime
}

export interface LiveClipState {
  readonly activeClipByTrackId: Readonly<Record<EntityId, ActiveClipLaunch>>
  readonly pendingLaunchByTrackId: Readonly<Record<EntityId, PendingClipLaunch>>
  readonly launchQuantize: ClipLaunchQuantize
  readonly launchQuantizeBeats: BeatTime
}

export class LiveClipService {
  private activeClipByTrackId: Record<EntityId, ActiveClipLaunch> = {}
  private pendingLaunchByTrackId: Record<EntityId, PendingClipLaunch> = {}
  private launchQuantize: ClipLaunchQuantize
  private launchQuantizeBeats: BeatTime

  constructor(launchQuantize: ClipLaunchQuantize | BeatTime = 'bar') {
    this.launchQuantize =
      typeof launchQuantize === 'number' ? 'bar' : launchQuantize
    this.launchQuantizeBeats = toQuantizeBeats(launchQuantize)
  }

  get state(): LiveClipState {
    return {
      activeClipByTrackId: { ...this.activeClipByTrackId },
      pendingLaunchByTrackId: { ...this.pendingLaunchByTrackId },
      launchQuantize: this.launchQuantize,
      launchQuantizeBeats: this.launchQuantizeBeats
    }
  }

  setLaunchQuantize(launchQuantize: ClipLaunchQuantize | BeatTime): void {
    if (typeof launchQuantize !== 'number') {
      this.launchQuantize = launchQuantize
    }

    this.launchQuantizeBeats = toQuantizeBeats(launchQuantize)
  }

  requestLaunch(
    trackId: EntityId,
    clipId: EntityId,
    clockState: ClockState,
    launchQuantize: ClipLaunchQuantize | BeatTime = this.launchQuantizeBeats
  ): PendingClipLaunch {
    const quantizeBeats = toQuantizeBeats(launchQuantize)
    const requestedAtBeat = Math.max(0, clockState.beat)
    const launchAtBeat = getNextQuantizedBeat(requestedAtBeat, quantizeBeats)
    const launch: PendingClipLaunch = {
      trackId,
      clipId,
      requestedAtBeat,
      launchAtBeat
    }

    this.launchQuantizeBeats = quantizeBeats
    if (typeof launchQuantize !== 'number') {
      this.launchQuantize = launchQuantize
    }

    if (!clockState.running || launchAtBeat <= requestedAtBeat) {
      this.activeClipByTrackId = {
        ...this.activeClipByTrackId,
        [trackId]: {
          trackId,
          clipId,
          launchedAtBeat: launchAtBeat
        }
      }
      this.cancelLaunch(trackId)
      return launch
    }

    this.pendingLaunchByTrackId = {
      ...this.pendingLaunchByTrackId,
      [trackId]: launch
    }
    return launch
  }

  cancelLaunch(trackId: EntityId): void {
    if (!this.pendingLaunchByTrackId[trackId]) return

    const nextPendingLaunchByTrackId = { ...this.pendingLaunchByTrackId }
    delete nextPendingLaunchByTrackId[trackId]
    this.pendingLaunchByTrackId = nextPendingLaunchByTrackId
  }

  clearActiveClip(trackId: EntityId): void {
    const nextActiveClipByTrackId = { ...this.activeClipByTrackId }
    delete nextActiveClipByTrackId[trackId]
    this.activeClipByTrackId = nextActiveClipByTrackId
    this.cancelLaunch(trackId)
  }

  resetLaunchOrigins(beat: BeatTime = 0): void {
    const nextActiveClipByTrackId: Record<EntityId, ActiveClipLaunch> = {}

    for (const [trackId, launch] of Object.entries(this.activeClipByTrackId)) {
      nextActiveClipByTrackId[trackId] = {
        ...launch,
        launchedAtBeat: beat
      }
    }

    this.activeClipByTrackId = nextActiveClipByTrackId
    this.pendingLaunchByTrackId = {}
  }

  applyDueLaunches(clockState: ClockState): AppliedClipLaunch[] {
    const dueLaunches = Object.values(this.pendingLaunchByTrackId).filter(
      (launch) => launch.launchAtBeat <= clockState.beat
    )

    if (dueLaunches.length === 0) return []

    const nextActiveClipByTrackId = { ...this.activeClipByTrackId }
    const nextPendingLaunchByTrackId = { ...this.pendingLaunchByTrackId }
    const appliedLaunches: AppliedClipLaunch[] = []

    for (const launch of dueLaunches) {
      const previousClipId = nextActiveClipByTrackId[launch.trackId]?.clipId

      nextActiveClipByTrackId[launch.trackId] = {
        trackId: launch.trackId,
        clipId: launch.clipId,
        launchedAtBeat: launch.launchAtBeat
      }
      delete nextPendingLaunchByTrackId[launch.trackId]
      appliedLaunches.push({
        trackId: launch.trackId,
        clipId: launch.clipId,
        previousClipId,
        launchAtBeat: launch.launchAtBeat
      })
    }

    this.activeClipByTrackId = nextActiveClipByTrackId
    this.pendingLaunchByTrackId = nextPendingLaunchByTrackId
    return appliedLaunches
  }
}

export function getNextQuantizedBeat(
  currentBeat: BeatTime,
  quantizeBeats: BeatTime
): BeatTime {
  if (!Number.isFinite(currentBeat)) return 0
  if (!Number.isFinite(quantizeBeats) || quantizeBeats <= 0) {
    return Math.max(0, currentBeat)
  }

  return Math.ceil(Math.max(0, currentBeat) / quantizeBeats) * quantizeBeats
}

function toQuantizeBeats(launchQuantize: ClipLaunchQuantize | BeatTime): BeatTime {
  if (typeof launchQuantize === 'number') return Math.max(0, launchQuantize)

  switch (launchQuantize) {
    case 'none':
      return 0
    case 'beat':
      return 1
    case '2-bars':
      return 8
    case '4-bars':
      return 16
    case 'bar':
    default:
      return 4
  }
}
