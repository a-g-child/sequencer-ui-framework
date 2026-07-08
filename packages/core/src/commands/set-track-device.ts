import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";

export class SetTrackDeviceCommand implements Command {
  readonly name = "Set Track Device";

  private previousDeviceId?: EntityId;

  constructor(
    readonly trackId: EntityId,
    readonly nextDeviceId: EntityId | undefined
  ) {}

  execute(document: SequencerDocument): void {
    const track = document.tracks.get(this.trackId);

    this.previousDeviceId = track.deviceId;
    track.deviceId = this.nextDeviceId;
  }

  undo(document: SequencerDocument): void {
    const track = document.tracks.get(this.trackId);

    track.deviceId = this.previousDeviceId;
  }
}

export { SetTrackDeviceCommand as SetTrackDeviceOperation };
