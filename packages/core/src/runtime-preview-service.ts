import type { DocumentStore } from "./document-store.ts";
import type { Service } from "./service.ts";

export class RuntimePreviewService implements Service {
  readonly id = "runtime-preview";
  readonly name = "Runtime Preview";

  private unsubscribe?: () => void;

  constructor(private readonly store: DocumentStore) {}

  initialise(): void {
    this.unsubscribe = this.store.events.subscribe((event) => {
      if (event.type === "parameter-preview") {
        console.log("runtime preview", event.parameterId, event.value);
      }

      if (event.type === "operation:executed") {
        console.log("runtime commit", event.operation?.name);
      }
    });
  }

  shutdown(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
