import type { SequencerDocument } from "./document.ts";

export interface Operation {
  readonly name: string;

  execute(document: SequencerDocument): void;

  undo(document: SequencerDocument): void;
}

export class CompositeOperation implements Operation {
  private readonly operations: Operation[] = [];

  constructor(readonly name: string) {}

  add(operation: Operation): this {
    this.operations.push(operation);
    return this;
  }

  execute(document: SequencerDocument): void {
    for (const operation of this.operations) {
      operation.execute(document);
    }
  }

  undo(document: SequencerDocument): void {
    for (let index = this.operations.length - 1; index >= 0; index--) {
      this.operations[index].undo(document);
    }
  }
}
