import type { Service, ServiceContext } from "./service.ts";
import type { TransportState } from "./transport.ts";

export class EditorTransportService implements Service {
  readonly id = "editor-transport";
  readonly name = "Editor Transport";

  readonly state: TransportState;

  private context?: ServiceContext;

  constructor(bpm = 120) {
    this.state = {
      playing: false,
      bpm,
      currentStep: 0,
      currentBeat: 0
    };
  }

  initialise(context: ServiceContext): void {
    this.context = context;
    this.emit("transport:playing-changed", { playing: this.state.playing });
    this.emit("transport:tempo-changed", { bpm: this.state.bpm });
    this.emit("transport:beat-changed", {
      currentBeat: this.state.currentBeat,
      currentStep: this.state.currentStep
    });
  }

  get playing(): boolean {
    return this.state.playing;
  }

  get bpm(): number {
    return this.state.bpm;
  }

  get currentBeat(): number {
    return this.state.currentBeat;
  }

  play(): void {
    if (this.state.playing) return;

    this.state.playing = true;
    this.emit("transport:playing-changed", { playing: this.state.playing });
  }

  stop(): void {
    const wasPlaying = this.state.playing;

    this.state.playing = false;
    this.state.currentBeat = 0;
    this.state.currentStep = 0;

    if (wasPlaying) {
      this.emit("transport:playing-changed", { playing: this.state.playing });
    }

    this.emit("transport:beat-changed", {
      currentBeat: this.state.currentBeat,
      currentStep: this.state.currentStep
    });
  }

  seek(beat: number): void {
    const nextBeat = Math.max(0, beat);

    this.state.currentBeat = nextBeat;
    this.state.currentStep = Math.floor(nextBeat);
    this.emit("transport:seeked", { beat: nextBeat });
    this.emit("transport:beat-changed", {
      currentBeat: this.state.currentBeat,
      currentStep: this.state.currentStep
    });
  }

  toggle(): void {
    if (this.state.playing) {
      this.stop();
      return;
    }

    this.play();
  }

  setBpm(bpm: number): void {
    if (this.state.bpm === bpm) return;

    this.state.bpm = bpm;
    this.emit("transport:tempo-changed", { bpm });
  }

  shutdown(): void {
    this.stop();
    this.context = undefined;
  }

  private emit<T>(type: string, payload: T): void {
    this.context?.events.emit({
      type,
      serviceId: this.id,
      payload
    });
  }
}

export { EditorTransportService as TransportService };
