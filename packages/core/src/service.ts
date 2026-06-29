import type { SequencerApplication } from "./application";
import type { DocumentStore } from "./document-store";

export interface ServiceEvent<T = unknown> {
  readonly type: string;
  readonly serviceId: string;
  readonly payload?: T;
}

export type ServiceEventListener = (event: ServiceEvent) => void;

export class ServiceEventBus {
  private readonly listeners = new Set<ServiceEventListener>();

  subscribe(listener: ServiceEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  emit<T>(event: ServiceEvent<T>): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export interface ServiceContext {
  readonly application: SequencerApplication;
  readonly documentStore: DocumentStore;
  readonly services: ServiceRegistry;
  readonly events: ServiceEventBus;
}

export interface Service {
  readonly id: string;
  readonly name: string;

  initialise?(context: ServiceContext): Promise<void> | void;
  shutdown?(context: ServiceContext): Promise<void> | void;
}

export class ServiceRegistry {
  private readonly services = new Map<string, Service>();

  add<T extends Service>(service: T): T {
    if (this.services.has(service.id)) {
      throw new Error(`Service already registered: ${service.id}`);
    }

    this.services.set(service.id, service);
    return service;
  }

  find<T extends Service = Service>(id: string): T | undefined {
    return this.services.get(id) as T | undefined;
  }

  get<T extends Service = Service>(id: string): T {
    const service = this.find<T>(id);

    if (!service) {
      throw new Error(`Service not found: ${id}`);
    }

    return service;
  }

  values(): Service[] {
    return [...this.services.values()];
  }

  async initialiseAll(context: ServiceContext): Promise<void> {
    for (const service of this.services.values()) {
      await service.initialise?.(context);
    }
  }

  async shutdownAll(context: ServiceContext): Promise<void> {
    const services = [...this.services.values()].reverse();

    for (const service of services) {
      await service.shutdown?.(context);
    }
  }
}
