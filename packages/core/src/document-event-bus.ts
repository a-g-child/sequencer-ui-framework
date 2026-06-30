import type { Entity, EntityId } from "./entity";
import type { Operation } from "./operation";
import type { SelectionItem } from "./selection";

export type DocumentEventType =
  | "operation:executed"
  | "operation:undone"
  | "operation:redone"
  | "selection:changed"
  | "clipboard:changed"
  | "parameter-preview";

export interface ParameterPreviewEvent {
  type: "parameter-preview";
  parameterId: string;
  value: unknown;
}

export interface BaseDocumentEvent {
  type: Exclude<DocumentEventType, "parameter-preview">;
  operation?: Operation;
  entityIds?: EntityId[];
  selection?: SelectionItem[];
  items?: Entity[];
  payload?: unknown;
}

export type DocumentEvent = BaseDocumentEvent | ParameterPreviewEvent;

export type DocumentEventListener = (event: DocumentEvent) => void;

export class DocumentEventBus {
  private readonly listeners = new Set<DocumentEventListener>();

  subscribe(listener: DocumentEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: DocumentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
