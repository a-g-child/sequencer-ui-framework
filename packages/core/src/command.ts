import type { SequencerDocument } from "./document";

export interface Command {
  readonly name: string;

  execute(document: SequencerDocument): void;

  undo(document: SequencerDocument): void;
}
