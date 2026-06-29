import { ClipboardModel } from "./clipboard";
import type { SequencerDocument } from "./document";
import { DocumentEventBus } from "./document-event-bus";
import type { Entity, EntityId } from "./entity";
import { OperationHistory } from "./history";
import type { Operation } from "./operation";
import { SelectionModel } from "./selection";

export interface DocumentObserver {
  onCommandExecuted(operation: Operation): void;
  onCommandUndone?(operation: Operation): void;
  onCommandRedone?(operation: Operation): void;
}

export class DocumentStore {
  readonly history = new OperationHistory();
  readonly selection = new SelectionModel();
  readonly clipboard = new ClipboardModel();
  readonly events = new DocumentEventBus();

  private readonly observers = new Set<DocumentObserver>();

  constructor(public readonly document: SequencerDocument) {}

  execute(operation: Operation): void {
    this.history.execute(this.document, operation);
    this.events.emit({ type: "operation:executed", operation });
    this.notifyCommandExecuted(operation);
  }

  undo(): void {
    const operation = this.history.undo(this.document);

    if (operation) {
      this.events.emit({ type: "operation:undone", operation });
      this.notifyCommandUndone(operation);
    }
  }

  redo(): void {
    const operation = this.history.redo(this.document);

    if (operation) {
      this.events.emit({ type: "operation:redone", operation });
      this.notifyCommandRedone(operation);
    }
  }

  setSelection(ids: EntityId[]): void {
    this.selection.set(ids);
    this.events.emit({
      type: "selection:changed",
      entityIds: this.selection.values()
    });
  }

  clearSelection(): void {
    this.selection.clear();
    this.events.emit({ type: "selection:changed", entityIds: [] });
  }

  setClipboard(items: Entity[]): void {
    this.clipboard.set(items);
    this.events.emit({
      type: "clipboard:changed",
      items: this.clipboard.values()
    });
  }

  clearClipboard(): void {
    this.clipboard.clear();
    this.events.emit({ type: "clipboard:changed", items: [] });
  }

  addObserver(observer: DocumentObserver): void {
    this.observers.add(observer);
  }

  removeObserver(observer: DocumentObserver): void {
    this.observers.delete(observer);
  }

  private notifyCommandExecuted(operation: Operation): void {
    for (const observer of this.observers) {
      observer.onCommandExecuted(operation);
    }
  }

  private notifyCommandUndone(operation: Operation): void {
    for (const observer of this.observers) {
      observer.onCommandUndone?.(operation);
    }
  }

  private notifyCommandRedone(operation: Operation): void {
    for (const observer of this.observers) {
      observer.onCommandRedone?.(operation);
    }
  }
}
