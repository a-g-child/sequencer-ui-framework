import { AudioEngineService } from "./audio-engine-service";
import type { SequencerDocument } from "./document";
import { DocumentStore } from "./document-store";
import { EditorTransportService } from "./editor-transport-service";
import { createDocument } from "./factory";
import { MidiService } from "./midi-service";
import { PreferencesService } from "./preferences-service";
import { RuntimePreviewService } from "./runtime-preview-service";
import {
  ServiceEventBus,
  ServiceRegistry,
  type ServiceContext
} from "./service";

export class SequencerApplication {
  readonly document: SequencerDocument;
  readonly documentStore: DocumentStore;
  readonly services = new ServiceRegistry();
  readonly serviceEvents = new ServiceEventBus();
  readonly editorTransport: EditorTransportService;
  readonly transport: EditorTransportService;
  readonly audioEngine: AudioEngineService;
  readonly midi: MidiService;
  readonly preferences: PreferencesService;

  constructor(document = createDocument()) {
    this.document = document;
    this.documentStore = new DocumentStore(document);
    this.editorTransport = new EditorTransportService(document.bpm);
    this.transport = this.editorTransport;
    this.audioEngine = new AudioEngineService();
    this.midi = new MidiService();
    this.preferences = new PreferencesService();

    this.services.add({
      id: "document-store",
      name: "Document Store",
      initialise: () => {},
      shutdown: () => {}
    });
    this.services.add(new RuntimePreviewService(this.documentStore));
    this.services.add(this.editorTransport);
    this.services.add(this.audioEngine);
    this.services.add(this.midi);
    this.services.add(this.preferences);
  }

  async initialise(): Promise<void> {
    await this.services.initialiseAll(this.createServiceContext());
  }

  async shutdown(): Promise<void> {
    await this.services.shutdownAll(this.createServiceContext());
  }

  private createServiceContext(): ServiceContext {
    return {
      application: this,
      documentStore: this.documentStore,
      services: this.services,
      events: this.serviceEvents
    };
  }
}
