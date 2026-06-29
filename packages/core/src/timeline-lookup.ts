import type { SequencerDocument } from "./document";
import type { EntityId } from "./entity";
import type { PatternPlacement } from "./project";

export function getPlacement(
  document: SequencerDocument,
  trackId: EntityId,
  placementId: EntityId
): PatternPlacement {
  const track = document.tracks.get(trackId);
  const placement = track.placements.find((item) => item.id === placementId);

  if (!placement) {
    throw new Error(`Placement not found: ${placementId}`);
  }

  return placement;
}
