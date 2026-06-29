import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";
import { getPlacement } from "../timeline-lookup";

export class SetPatternPlacementLoopCountCommand implements Command {
  readonly name = "Set Pattern Placement Loop Count";

  private previousLoopCount?: number;

  constructor(
    private readonly trackId: EntityId,
    private readonly placementId: EntityId,
    private readonly nextLoopCount: number
  ) {}

  execute(document: SequencerDocument): void {
    const placement = getPlacement(document, this.trackId, this.placementId);

    this.previousLoopCount = placement.loopCount;
    placement.loopCount = this.nextLoopCount;
  }

  undo(document: SequencerDocument): void {
    const placement = getPlacement(document, this.trackId, this.placementId);
    placement.loopCount = this.previousLoopCount;
  }
}

export {
  SetPatternPlacementLoopCountCommand as SetPatternPlacementLoopCountOperation
};
