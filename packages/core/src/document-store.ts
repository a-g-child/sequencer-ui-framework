import { ClipboardModel } from "./clipboard";
import type { SequencerDocument } from "./document";
import { DocumentEventBus } from "./document-event-bus";
import type { Entity } from "./entity";
import { OperationHistory } from "./history";
import type { Operation } from "./operation";
import { SelectionModel, type SelectionItem } from "./selection";

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

  constructor(private currentDocument: SequencerDocument) {}

  get document(): SequencerDocument {
    return this.currentDocument;
  }

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

  setSelection(selection: SelectionItem | SelectionItem[]): void {
    const items = Array.isArray(selection) ? selection : [selection];

    this.selection.set(items);
    this.events.emit({
      type: "selection:changed",
      entityIds: items.map((item) => item.id),
      selection: this.selection.values()
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

  setClipboardPayload(payload: unknown): void {
    this.clipboard.setPayload(payload);
    this.events.emit({
      type: "clipboard:changed",
      payload
    });
  }

  clearClipboard(): void {
    this.clipboard.clear();
    this.events.emit({
      type: "clipboard:changed",
      items: [],
      payload: undefined
    });
  }

  replaceDocument(document: SequencerDocument): void {
    this.currentDocument = document;
    this.history.clear();
    this.selection.clear();
    this.clipboard.clear();
    const operation: Operation = {
      name: "Replace Document",
      execute: () => {},
      undo: () => {}
    };

    this.events.emit({ type: "document:replaced", operation });
    this.notifyCommandExecuted(operation);
  }

  previewParameterValue(parameterId: string, value: unknown): void {
    this.events.emit({
      type: "parameter-preview",
      parameterId,
      value
    });
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
