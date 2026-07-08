export type AssetId = string;

export type AssetKind =
  | 'audio-sample'
  | 'impulse-response'
  | 'wavetable'
  | 'midi-file'
  | 'preset'
  | 'firmware'
  | 'unknown';

export type AssetReference = {
  id: AssetId;
  kind: AssetKind;
  name: string;
  uri?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
  missing?: boolean;
};
