import type { SequencerDocument } from "./document.ts";
import type { Operation } from "./operation.ts";

export class OperationHistory {
  private undoStack: Operation[] = [];
  private redoStack: Operation[] = [];

  execute(document: SequencerDocument, operation: Operation): void {
    operation.execute(document);
    this.undoStack.push(operation);
    this.redoStack = [];
  }

  undo(document: SequencerDocument): Operation | undefined {
    const operation = this.undoStack.pop();

    if (!operation) return undefined;

    operation.undo(document);
    this.redoStack.push(operation);

    return operation;
  }

  redo(document: SequencerDocument): Operation | undefined {
    const operation = this.redoStack.pop();

    if (!operation) return undefined;

    operation.execute(document);
    this.undoStack.push(operation);

    return operation;
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

export class CommandHistory extends OperationHistory {}
