import type { Command } from "../command.ts";
import type { SequencerDocument } from "../document.ts";
import type { EntityId } from "../entity.ts";

export class SetMidiClipLoopCommand implements Command {
  readonly name = "Set MIDI Clip Loop";

  private previousLoop?: boolean;

  constructor(
    private readonly clipId: EntityId,
    private readonly nextLoop: boolean
  ) {}

  execute(document: SequencerDocument): void {
    const clip = document.midiClips.get(this.clipId);

    this.previousLoop = clip.loopEnabled;
    clip.loopEnabled = this.nextLoop;
  }

  undo(document: SequencerDocument): void {
    if (this.previousLoop === undefined) return;

    const clip = document.midiClips.get(this.clipId);
    clip.loopEnabled = this.previousLoop;
  }
}

export { SetMidiClipLoopCommand as SetMidiClipLoopOperation };
