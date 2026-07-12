import type { Command } from "../command.ts";
import type { SequencerDocument } from "../document.ts";
import type { EntityId } from "../entity.ts";

export class SetTrackDeviceCommand implements Command {
  readonly name = "Set Track Device";

  private previousDeviceId?: EntityId;
  private previousDeviceIds?: EntityId[];

  constructor(
    readonly trackId: EntityId,
    readonly nextDeviceId: EntityId | undefined
  ) {}

  execute(document: SequencerDocument): void {
    const track = document.tracks.get(this.trackId);

    this.previousDeviceId = track.deviceId;
    this.previousDeviceIds = track.deviceIds ? [...track.deviceIds] : undefined;
    track.deviceId = this.nextDeviceId;
    track.deviceIds = this.nextDeviceId ? [this.nextDeviceId] : [];
  }

  undo(document: SequencerDocument): void {
    const track = document.tracks.get(this.trackId);

    track.deviceId = this.previousDeviceId;
    track.deviceIds = this.previousDeviceIds;
  }
}

export { SetTrackDeviceCommand as SetTrackDeviceOperation };
