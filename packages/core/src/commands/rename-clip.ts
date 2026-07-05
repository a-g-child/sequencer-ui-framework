import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";

export class RenameClipCommand implements Command {
  readonly name = "Rename Clip";

  private previousClipName?: string;
  private previousSlotNames = new Map<EntityId, string>();

  constructor(
    private readonly clipId: EntityId,
    private readonly nextName: string
  ) {}

  execute(document: SequencerDocument): void {
    const clip = document.midiClips.get(this.clipId);

    this.previousClipName = clip.name;
    clip.name = this.nextName;

    for (const track of document.tracks.values()) {
      for (const slot of track.clips) {
        if (slot.target !== this.clipId) continue;

        this.previousSlotNames.set(slot.id, slot.name);
        slot.name = this.nextName;
      }
    }
  }

  undo(document: SequencerDocument): void {
    if (this.previousClipName === undefined) return;

    document.midiClips.get(this.clipId).name = this.previousClipName;

    for (const track of document.tracks.values()) {
      for (const slot of track.clips) {
        const previousName = this.previousSlotNames.get(slot.id);

        if (previousName !== undefined) {
          slot.name = previousName;
        }
      }
    }
  }
}

export { RenameClipCommand as RenameClipOperation };
