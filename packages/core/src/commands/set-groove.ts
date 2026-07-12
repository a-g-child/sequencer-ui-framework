import type { Command } from "../command.ts";
import type { SequencerDocument } from "../document.ts";
import {
  normalizeGrooveSettings,
  type GrooveSettings
} from "../groove.ts";

export class SetGrooveCommand implements Command {
  readonly name = "Set Groove";

  private previousGroove?: GrooveSettings;

  constructor(readonly groove: Partial<GrooveSettings>) {}

  execute(document: SequencerDocument): void {
    this.previousGroove = { ...document.groove };
    document.groove = normalizeGrooveSettings({
      ...document.groove,
      ...this.groove
    });
  }

  undo(document: SequencerDocument): void {
    if (!this.previousGroove) return;

    document.groove = this.previousGroove;
  }
}

export { SetGrooveCommand as SetGrooveOperation };
