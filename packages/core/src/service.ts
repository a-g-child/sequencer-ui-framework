export interface Service {
  readonly id: string;
  readonly name: string;

  initialise?(): Promise<void> | void;
  shutdown?(): Promise<void> | void;
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

  async initialiseAll(): Promise<void> {
    for (const service of this.services.values()) {
      await service.initialise?.();
    }
  }

  async shutdownAll(): Promise<void> {
    const services = [...this.services.values()].reverse();

    for (const service of services) {
      await service.shutdown?.();
    }
  }
}
