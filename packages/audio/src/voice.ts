export type VoiceState = 'active' | 'released' | 'stolen';

export type VoiceId = string;

export type AdsrEnvelope = {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
};

export type Voice = {
  id: VoiceId;
  noteId?: string;
  trackId?: string;
  pitch: number;
  velocity: number;
  startedAtMs: number;
  releasedAtMs?: number;
  state: VoiceState;
};

export type VoiceAction =
  | {
      type: 'voice:start';
      voiceId: string;
      trackId?: string;
      noteId?: string;
      pitch: number;
      velocity: number;
      amplitude?: number;
      timeMs: number;
      envelope?: AdsrEnvelope;
    }
  | { type: 'voice:release'; voiceId: string; timeMs: number }
  | { type: 'voice:steal'; voiceId: string; timeMs: number };
