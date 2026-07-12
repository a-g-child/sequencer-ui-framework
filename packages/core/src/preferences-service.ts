import type { Service, ServiceContext } from "./service.ts";

export class PreferencesService implements Service {
  readonly id = "preferences";
  readonly name = "Preferences";

  private readonly values = new Map<string, unknown>();
  private context?: ServiceContext;

  initialise(context: ServiceContext): void {
    this.context = context;
    this.context.events.emit({
      type: "preferences:loaded",
      serviceId: this.id,
      payload: { status: "loaded" }
    });
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value);
    this.context?.events.emit({
      type: "preferences:changed",
      serviceId: this.id,
      payload: { key, value }
    });
  }

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  shutdown(): void {
    this.context = undefined;
  }
}
