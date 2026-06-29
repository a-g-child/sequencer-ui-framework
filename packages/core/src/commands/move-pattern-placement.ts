import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";
import type { BeatTime } from "../events";
import { getPlacement } from "../timeline-lookup";

export class MovePatternPlacementCommand implements Command {
  readonly name = "Move Pattern Placement";

  private previousStart?: BeatTime;

  constructor(
    private readonly trackId: EntityId,
    private readonly placementId: EntityId,
    private readonly nextStart: BeatTime
  ) {}

  execute(document: SequencerDocument): void {
    const placement = getPlacement(document, this.trackId, this.placementId);

    this.previousStart = placement.start;
    placement.start = this.nextStart;
  }

  undo(document: SequencerDocument): void {
    if (this.previousStart === undefined) return;

    const placement = getPlacement(document, this.trackId, this.placementId);
    placement.start = this.previousStart;
  }
}

export { MovePatternPlacementCommand as MovePatternPlacementOperation };
