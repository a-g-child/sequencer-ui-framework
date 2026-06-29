import type { Entity, EntityId } from "./entity";
import type { Operation } from "./operation";

export type DocumentEventType =
  | "operation:executed"
  | "operation:undone"
  | "operation:redone"
  | "selection:changed"
  | "clipboard:changed";

export interface DocumentEvent {
  type: DocumentEventType;
  operation?: Operation;
  entityIds?: EntityId[];
  items?: Entity[];
}

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
