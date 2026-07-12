import type { Voice, VoiceId } from './voice.ts';

export type VoiceManagerStats = {
  maxVoices: number;
  activeVoices: number;
  releasedVoices: number;
  stolenVoices: number;
  totalStarted: number;
  totalReleased: number;
  totalStolen: number;
};

export type StartVoiceOptions = {
  noteId?: string;
  trackId?: string;
  pitch: number;
  velocity: number;
  nowMs: number;
};

export type StartVoiceResult = {
  voice: Voice;
  stolenVoice?: Voice;
};

export class VoiceManager {
  private readonly voices = new Map<VoiceId, Voice>();

  private nextId = 1;
  private totalStarted = 0;
  private totalReleased = 0;
  private totalStolen = 0;
  private readonly maxVoices: number;

  constructor(maxVoices = 8) {
    this.maxVoices = maxVoices;
  }

  startVoice(options: StartVoiceOptions): Voice {
    return this.startVoiceWithStealing(options).voice;
  }

  startVoiceWithStealing(options: StartVoiceOptions): StartVoiceResult {
    const stolenVoice = this.ensureCapacity(options.nowMs);

    const voice: Voice = {
      id: `voice-${this.nextId++}`,
      noteId: options.noteId,
      trackId: options.trackId,
      pitch: options.pitch,
      velocity: options.velocity,
      startedAtMs: options.nowMs,
      state: 'active'
    };

    this.voices.set(voice.id, voice);
    this.totalStarted += 1;

    return { voice, stolenVoice };
  }

  releaseVoiceByNote(noteId: string, nowMs: number): Voice[] {
    const released: Voice[] = [];

    for (const voice of this.voices.values()) {
      if (voice.noteId !== noteId || voice.state !== 'active') continue;

      voice.state = 'released';
      voice.releasedAtMs = nowMs;
      this.totalReleased += 1;
      released.push(voice);
    }

    return released;
  }

  releaseVoiceByPitch(
    trackId: string | undefined,
    pitch: number,
    nowMs: number
  ): Voice[] {
    const released: Voice[] = [];

    for (const voice of this.voices.values()) {
      if (voice.state !== 'active') continue;
      if (voice.pitch !== pitch) continue;
      if (trackId && voice.trackId !== trackId) continue;

      voice.state = 'released';
      voice.releasedAtMs = nowMs;
      this.totalReleased += 1;
      released.push(voice);
    }

    return released;
  }

  activeVoices(): Voice[] {
    return [...this.voices.values()].filter((voice) => voice.state === 'active');
  }

  voicesSnapshot(): Voice[] {
    return [...this.voices.values()].map((voice) => ({ ...voice }));
  }

  stats(): VoiceManagerStats {
    const voices = [...this.voices.values()];

    return {
      maxVoices: this.maxVoices,
      activeVoices: voices.filter((voice) => voice.state === 'active').length,
      releasedVoices: voices.filter((voice) => voice.state === 'released').length,
      stolenVoices: voices.filter((voice) => voice.state === 'stolen').length,
      totalStarted: this.totalStarted,
      totalReleased: this.totalReleased,
      totalStolen: this.totalStolen
    };
  }

  clearReleased(): void {
    for (const [id, voice] of this.voices.entries()) {
      if (voice.state === 'released' || voice.state === 'stolen') {
        this.voices.delete(id);
      }
    }
  }

  clear(): void {
    this.voices.clear();
  }

  private ensureCapacity(nowMs: number): Voice | undefined {
    const active = this.activeVoices();

    if (active.length < this.maxVoices) return undefined;

    const oldest = [...active].sort(
      (a, b) => a.startedAtMs - b.startedAtMs
    )[0];

    if (!oldest) return undefined;

    oldest.state = 'stolen';
    oldest.releasedAtMs = nowMs;
    this.totalStolen += 1;

    return oldest;
  }
}
