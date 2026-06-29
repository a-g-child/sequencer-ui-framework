import type { Command } from "./command";
import { CommandHistory } from "./history";
import type { SequencerDocument } from "./document";

export interface DocumentObserver {
  onCommandExecuted(command: Command): void;
  onCommandUndone?(command: Command): void;
  onCommandRedone?(command: Command): void;
}

export class DocumentStore {
  readonly history = new CommandHistory();

  private readonly observers = new Set<DocumentObserver>();

  constructor(public readonly document: SequencerDocument) {}

  execute(command: Command): void {
    this.history.execute(this.document, command);
    this.notifyCommandExecuted(command);
  }

  undo(): void {
    const command = this.history.undo(this.document);

    if (command) {
      this.notifyCommandUndone(command);
    }
  }

  redo(): void {
    const command = this.history.redo(this.document);

    if (command) {
      this.notifyCommandRedone(command);
    }
  }

  addObserver(observer: DocumentObserver): void {
    this.observers.add(observer);
  }

  removeObserver(observer: DocumentObserver): void {
    this.observers.delete(observer);
  }

  private notifyCommandExecuted(command: Command): void {
    for (const observer of this.observers) {
      observer.onCommandExecuted(command);
    }
  }

  private notifyCommandUndone(command: Command): void {
    for (const observer of this.observers) {
      observer.onCommandUndone?.(command);
    }
  }

  private notifyCommandRedone(command: Command): void {
    for (const observer of this.observers) {
      observer.onCommandRedone?.(command);
    }
  }
}
