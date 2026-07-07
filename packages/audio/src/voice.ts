export type VoiceState = 'active' | 'released' | 'stolen';

export type VoiceId = string;

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
      timeMs: number;
    }
  | { type: 'voice:release'; voiceId: string; timeMs: number }
  | { type: 'voice:steal'; voiceId: string; timeMs: number };
