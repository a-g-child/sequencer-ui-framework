import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";
import type { BeatTime } from "../events";
import { getPlacement } from "../timeline-lookup";

export class SetPatternPlacementLoopRegionCommand implements Command {
  readonly name = "Set Pattern Placement Loop Region";

  private previousLoopStart: BeatTime | undefined;
  private previousLoopLength: BeatTime | undefined;

  constructor(
    private readonly trackId: EntityId,
    private readonly placementId: EntityId,
    private readonly nextLoopStart: BeatTime,
    private readonly nextLoopLength: BeatTime
  ) {}

  execute(document: SequencerDocument): void {
    const placement = getPlacement(document, this.trackId, this.placementId);

    this.previousLoopStart = placement.loopStart;
    this.previousLoopLength = placement.loopLength;
    placement.loopStart = this.nextLoopStart;
    placement.loopLength = this.nextLoopLength;
  }

  undo(document: SequencerDocument): void {
    const placement = getPlacement(document, this.trackId, this.placementId);
    placement.loopStart = this.previousLoopStart;
    placement.loopLength = this.previousLoopLength;
  }
}

export {
  SetPatternPlacementLoopRegionCommand as SetPatternPlacementLoopRegionOperation
};
