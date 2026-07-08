import type { AssetId } from '@sequencer/assets';

export type SamplerMode = 'pitched' | 'multi';

export type SampleSlot = {
  id: string;
  name: string;
  assetId?: AssetId;
  rootNote: number;
  gain: number;
  start: number;
  end?: number;
  loop: boolean;
  loopStart?: number;
  loopEnd?: number;
};
