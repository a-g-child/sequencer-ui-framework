import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";
import type { BeatTime } from "../events";

export class SetMidiClipLoopRegionCommand implements Command {
  readonly name = "Set MIDI Clip Loop Region";

  private previousLoopStart?: BeatTime;
  private previousLoopLength?: BeatTime;

  constructor(
    private readonly clipId: EntityId,
    private readonly nextLoopStart: BeatTime,
    private readonly nextLoopLength: BeatTime
  ) {}

  execute(document: SequencerDocument): void {
    const clip = document.midiClips.get(this.clipId);

    this.previousLoopStart = clip.loopStart;
    this.previousLoopLength = clip.loopLength;
    clip.loopStart = this.nextLoopStart;
    clip.loopLength = this.nextLoopLength;
  }

  undo(document: SequencerDocument): void {
    if (
      this.previousLoopStart === undefined ||
      this.previousLoopLength === undefined
    ) {
      return;
    }

    const clip = document.midiClips.get(this.clipId);
    clip.loopStart = this.previousLoopStart;
    clip.loopLength = this.previousLoopLength;
  }
}

export { SetMidiClipLoopRegionCommand as SetMidiClipLoopRegionOperation };
