import type { Command } from "../command.ts";
import type { SequencerDocument } from "../document.ts";
import { createId, type EntityId } from "../entity.ts";
import type { TimelineEvent } from "../events.ts";
import type { MidiClip, Pattern, TrackClipSlot } from "../project.ts";

type RemovedSlot = {
  trackId: EntityId;
  slot: TrackClipSlot;
  clip?: MidiClip;
};

export class CopyClipToTrackSlotCommand implements Command {
  readonly name = "Copy Clip To Track Slot";

  readonly pattern: Pattern;
  readonly clip: MidiClip;
  readonly slot: TrackClipSlot;
  private removedSlots: RemovedSlot[] = [];

  constructor(
    sourceClip: MidiClip,
    sourcePattern: Pattern,
    private readonly targetTrackId: EntityId,
    private readonly targetSlotIndex: number
  ) {
    const name = `${sourceClip.name} Copy`;

    this.pattern = {
      id: createId("pattern"),
      name,
      length: sourcePattern.length,
      events: sourcePattern.events.map(cloneTimelineEvent)
    };
    this.clip = {
      id: createId("clip"),
      name,
      pattern: this.pattern.id,
      length: sourceClip.length,
      loopEnabled: sourceClip.loopEnabled,
      loopStart: sourceClip.loopStart,
      loopLength: sourceClip.loopLength
    };
    this.slot = {
      id: createId("clip_slot"),
      name,
      source: targetTrackId,
      target: this.clip.id,
      slotIndex: targetSlotIndex
    };
  }

  execute(document: SequencerDocument): void {
    const track = document.tracks.get(this.targetTrackId);
    this.removedSlots = [];

    track.clips = track.clips.filter((slot) => {
      if (slot.slotIndex !== this.targetSlotIndex) return true;

      const remainingReferences = document.tracks
        .values()
        .flatMap((item) => item.clips)
        .filter((item) => item.id !== slot.id && item.target === slot.target);
      const clip =
        remainingReferences.length === 0
          ? document.midiClips.find(slot.target)
          : undefined;

      this.removedSlots.push({ trackId: track.id, slot, clip });

      if (clip) {
        document.midiClips.remove(clip.id);
      }

      return false;
    });

    document.patterns.add(this.pattern);
    document.midiClips.add(this.clip);
    track.clips.push(this.slot);
    track.clips.sort((a, b) => a.slotIndex - b.slotIndex);
  }

  undo(document: SequencerDocument): void {
    const track = document.tracks.get(this.targetTrackId);

    track.clips = track.clips.filter((slot) => slot.id !== this.slot.id);
    document.midiClips.remove(this.clip.id);
    document.patterns.remove(this.pattern.id);

    for (const removed of this.removedSlots) {
      const removedTrack = document.tracks.get(removed.trackId);

      if (removed.clip && !document.midiClips.find(removed.clip.id)) {
        document.midiClips.add(removed.clip);
      }

      removedTrack.clips.push(removed.slot);
      removedTrack.clips.sort((a, b) => a.slotIndex - b.slotIndex);
    }
  }
}

function cloneTimelineEvent<T>(event: TimelineEvent<T>): TimelineEvent<T> {
  return {
    ...event,
    id: createId(event.type === "trigger" ? "note" : "event"),
    value: structuredClone(event.value)
  };
}

export { CopyClipToTrackSlotCommand as CopyClipToTrackSlotOperation };
