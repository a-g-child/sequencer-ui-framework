import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";

export class SetTrackDeviceChainCommand implements Command {
  readonly name = "Set Track Device Chain";

  private previousDeviceId?: EntityId;
  private previousDeviceIds?: EntityId[];

  constructor(
    readonly trackId: EntityId,
    readonly nextDeviceIds: readonly EntityId[]
  ) {}

  execute(document: SequencerDocument): void {
    const track = document.tracks.get(this.trackId);

    this.previousDeviceId = track.deviceId;
    this.previousDeviceIds = track.deviceIds ? [...track.deviceIds] : undefined;
    track.deviceIds = [...this.nextDeviceIds];
    track.deviceId = this.nextDeviceIds.at(-1);
  }

  undo(document: SequencerDocument): void {
    const track = document.tracks.get(this.trackId);

    track.deviceId = this.previousDeviceId;
    track.deviceIds = this.previousDeviceIds;
  }
}

export { SetTrackDeviceChainCommand as SetTrackDeviceChainOperation };
