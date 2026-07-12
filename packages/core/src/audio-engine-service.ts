import type { Service, ServiceContext } from "./service.ts";

export class AudioEngineService implements Service {
  readonly id = "audio-engine";
  readonly name = "Audio Engine";

  private context?: ServiceContext;
  private running = false;

  initialise(context: ServiceContext): void {
    this.context = context;
    this.context.events.emit({
      type: "audio-engine:status-changed",
      serviceId: this.id,
      payload: { status: "idle" }
    });
  }

  play(): void {
    if (this.running) return;

    this.running = true;
    this.context?.events.emit({
      type: "audio-engine:playing-changed",
      serviceId: this.id,
      payload: { playing: true }
    });
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;
    this.context?.events.emit({
      type: "audio-engine:playing-changed",
      serviceId: this.id,
      payload: { playing: false }
    });
  }

  shutdown(): void {
    this.stop();
    this.context = undefined;
  }
}
