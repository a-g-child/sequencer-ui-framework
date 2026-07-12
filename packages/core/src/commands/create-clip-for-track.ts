import type { Command } from "../command.ts";
import type { SequencerDocument } from "../document.ts";
import type { EntityId } from "../entity.ts";
import type { BeatTime } from "../events.ts";
import {
  createMidiClip,
  createPattern,
  createTrackClipSlot
} from "../factory.ts";
import type { MidiClip, Pattern, TrackClipSlot } from "../project.ts";

export class CreateClipForTrackCommand implements Command {
  readonly name = "Create Clip For Track";

  readonly pattern: Pattern;
  readonly clip: MidiClip;
  readonly slot: TrackClipSlot;
  private readonly requestedSlotIndex: number | undefined;
  private slotIndexAssigned = false;

  constructor(
    private readonly trackId: EntityId,
    clipName = "Clip",
    length: BeatTime = 16,
    slotIndex?: number
  ) {
    this.requestedSlotIndex = slotIndex;
    this.pattern = createPattern(clipName, length);
    this.clip = createMidiClip(this.pattern.id, clipName, length);
    this.slot = createTrackClipSlot(
      trackId,
      this.clip.id,
      slotIndex ?? 0,
      clipName
    );
  }

  execute(document: SequencerDocument): void {
    const track = document.tracks.get(this.trackId);

    if (!this.slotIndexAssigned) {
      this.slot.slotIndex = this.requestedSlotIndex ?? nextSlotIndex(track.clips);
      this.slotIndexAssigned = true;
    }

    document.patterns.add(this.pattern);
    document.midiClips.add(this.clip);
    track.clips.push(this.slot);
  }

  undo(document: SequencerDocument): void {
    const track = document.tracks.get(this.trackId);

    track.clips = track.clips.filter((slot) => slot.id !== this.slot.id);
    document.midiClips.remove(this.clip.id);
    document.patterns.remove(this.pattern.id);
  }
}

function nextSlotIndex(slots: TrackClipSlot[]): number {
  return slots.reduce(
    (nextIndex, slot) => Math.max(nextIndex, slot.slotIndex + 1),
    0
  );
}

export { CreateClipForTrackCommand as CreateClipForTrackOperation };
