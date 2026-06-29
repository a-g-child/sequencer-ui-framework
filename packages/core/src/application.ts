import type { SequencerDocument } from "./document";
import { DocumentStore } from "./document-store";
import { createDocument } from "./factory";
import { RuntimePreviewService } from "./runtime-preview-service";
import { ServiceRegistry } from "./service";

export class SequencerApplication {
  readonly document: SequencerDocument;
  readonly documentStore: DocumentStore;
  readonly services = new ServiceRegistry();

  constructor(document = createDocument()) {
    this.document = document;
    this.documentStore = new DocumentStore(document);

    this.services.add({
      id: "document-store",
      name: "Document Store",
      initialise: () => {},
      shutdown: () => {}
    });
    this.services.add(new RuntimePreviewService(this.documentStore));
  }

  async initialise(): Promise<void> {
    await this.services.initialiseAll();
  }

  async shutdown(): Promise<void> {
    await this.services.shutdownAll();
  }
}
