import type { Command } from "./command";
import type { SequencerDocument } from "./document";

export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  execute(document: SequencerDocument, command: Command): void {
    command.execute(document);
    this.undoStack.push(command);
    this.redoStack = [];
  }

  undo(document: SequencerDocument): Command | undefined {
    const command = this.undoStack.pop();

    if (!command) return undefined;

    command.undo(document);
    this.redoStack.push(command);

    return command;
  }

  redo(document: SequencerDocument): Command | undefined {
    const command = this.redoStack.pop();

    if (!command) return undefined;

    command.execute(document);
    this.undoStack.push(command);

    return command;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
