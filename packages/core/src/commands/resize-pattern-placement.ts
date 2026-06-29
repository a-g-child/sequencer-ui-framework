import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";
import type { BeatTime } from "../events";
import { getPlacement } from "../timeline-lookup";

export class ResizePatternPlacementCommand implements Command {
  readonly name = "Resize Pattern Placement";

  private hasPreviousLength = false;
  private previousLength: BeatTime | undefined;

  constructor(
    private readonly trackId: EntityId,
    private readonly placementId: EntityId,
    private readonly nextLength: BeatTime
  ) {}

  execute(document: SequencerDocument): void {
    const placement = getPlacement(document, this.trackId, this.placementId);

    this.previousLength = placement.length;
    this.hasPreviousLength = true;
    placement.length = this.nextLength;
  }

  undo(document: SequencerDocument): void {
    if (!this.hasPreviousLength) return;

    const placement = getPlacement(document, this.trackId, this.placementId);
    placement.length = this.previousLength;
  }
}

export { ResizePatternPlacementCommand as ResizePatternPlacementOperation };
