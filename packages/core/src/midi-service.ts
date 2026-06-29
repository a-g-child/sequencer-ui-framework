import type { Service, ServiceContext } from "./service";

export class MidiService implements Service {
  readonly id = "midi";
  readonly name = "MIDI";

  private context?: ServiceContext;

  initialise(context: ServiceContext): void {
    this.context = context;
    this.context.events.emit({
      type: "midi:initialised",
      serviceId: this.id
    });
  }

  shutdown(): void {
    this.context?.events.emit({
      type: "midi:shutdown",
      serviceId: this.id
    });
    this.context = undefined;
  }
}
