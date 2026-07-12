import type { Command } from "../command.ts";
import type { SequencerDocument } from "../document.ts";
import type { EntityId } from "../entity.ts";
import type { BeatTime } from "../events.ts";

export class ResizeMidiClipCommand implements Command {
  readonly name = "Resize MIDI Clip";

  private previousLength?: BeatTime;

  constructor(
    private readonly clipId: EntityId,
    private readonly nextLength: BeatTime
  ) {}

  execute(document: SequencerDocument): void {
    const clip = document.midiClips.get(this.clipId);

    this.previousLength = clip.length;
    clip.length = this.nextLength;
  }

  undo(document: SequencerDocument): void {
    if (this.previousLength === undefined) return;

    const clip = document.midiClips.get(this.clipId);
    clip.length = this.previousLength;
  }
}

export { ResizeMidiClipCommand as ResizeMidiClipOperation };
