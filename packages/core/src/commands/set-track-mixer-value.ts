import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";
import type { TrackMixerState } from "../project";
import { createDefaultTrackMixerState } from "../project";

export type TrackMixerKey = keyof TrackMixerState;

export class SetTrackMixerValueCommand<K extends TrackMixerKey = TrackMixerKey>
  implements Command
{
  readonly name = "Set Track Mixer Value";

  private previousValue?: TrackMixerState[K];

  constructor(
    readonly trackId: EntityId,
    readonly key: K,
    readonly value: TrackMixerState[K]
  ) {}

  execute(document: SequencerDocument): void {
    const track = document.tracks.get(this.trackId);

    track.mixer ??= createDefaultTrackMixerState();
    this.previousValue = track.mixer[this.key] as TrackMixerState[K];
    track.mixer[this.key] = normalizeMixerValue(
      this.key,
      this.value
    ) as TrackMixerState[K];
  }

  undo(document: SequencerDocument): void {
    if (this.previousValue === undefined) return;

    const track = document.tracks.get(this.trackId);

    track.mixer ??= createDefaultTrackMixerState();
    track.mixer[this.key] = this.previousValue;
  }
}

function normalizeMixerValue(
  key: TrackMixerKey,
  value: TrackMixerState[TrackMixerKey]
): TrackMixerState[TrackMixerKey] {
  if (key === "volume") {
    return clampNumber(Number(value), 0, 1);
  }

  if (key === "pan") {
    return clampNumber(Number(value), -1, 1);
  }

  return Boolean(value);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;

  return Math.min(max, Math.max(min, value));
}

export { SetTrackMixerValueCommand as SetTrackMixerValueOperation };
