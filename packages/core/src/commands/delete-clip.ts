import type { Command } from "../command.ts";
import type { SequencerDocument } from "../document.ts";
import type { EntityId } from "../entity.ts";
import type { MidiClip, TrackClipSlot } from "../project.ts";

type RemovedSlot = {
  trackId: EntityId;
  slot: TrackClipSlot;
};

export class DeleteClipCommand implements Command {
  readonly name = "Delete Clip";

  private clip?: MidiClip;
  private removedSlots: RemovedSlot[] = [];

  constructor(private readonly clipId: EntityId) {}

  execute(document: SequencerDocument): void {
    this.clip = document.midiClips.get(this.clipId);
    this.removedSlots = [];

    for (const track of document.tracks.values()) {
      const remainingSlots: TrackClipSlot[] = [];

      for (const slot of track.clips) {
        if (slot.target === this.clipId) {
          this.removedSlots.push({ trackId: track.id, slot });
          continue;
        }

        remainingSlots.push(slot);
      }

      track.clips = remainingSlots;
    }

    document.midiClips.remove(this.clipId);
  }

  undo(document: SequencerDocument): void {
    if (!this.clip) return;

    document.midiClips.add(this.clip);

    for (const removed of this.removedSlots) {
      const track = document.tracks.get(removed.trackId);
      track.clips.push(removed.slot);
      track.clips.sort((a, b) => a.slotIndex - b.slotIndex);
    }
  }
}

export { DeleteClipCommand as DeleteClipOperation };
