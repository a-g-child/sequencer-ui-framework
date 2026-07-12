import type { Command } from "../command.ts";
import type { SequencerDocument } from "../document.ts";
import type { EntityId } from "../entity.ts";
import { getPlacement } from "../timeline-lookup.ts";

export class SetPatternPlacementLoopCommand implements Command {
  readonly name = "Set Pattern Placement Loop";

  private previousLoop?: boolean;

  constructor(
    private readonly trackId: EntityId,
    private readonly placementId: EntityId,
    private readonly nextLoop: boolean
  ) {}

  execute(document: SequencerDocument): void {
    const placement = getPlacement(document, this.trackId, this.placementId);

    this.previousLoop = placement.loop;
    placement.loop = this.nextLoop;
  }

  undo(document: SequencerDocument): void {
    const placement = getPlacement(document, this.trackId, this.placementId);
    placement.loop = this.previousLoop;
  }
}

export { SetPatternPlacementLoopCommand as SetPatternPlacementLoopOperation };
