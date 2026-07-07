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
