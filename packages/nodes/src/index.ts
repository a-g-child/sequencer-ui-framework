export * from './audio.ts';
export * from './control.ts';
export * from './converters.ts';
export * from './hardware.ts';
export * from './midi.ts';
export * from './types.ts';

import { AUDIO_NODE_DESCRIPTORS } from './audio.ts';
import { CONTROL_NODE_DESCRIPTORS } from './control.ts';
import { CONVERTER_NODE_DESCRIPTORS } from './converters.ts';
import { HARDWARE_NODE_DESCRIPTORS } from './hardware.ts';
import { MIDI_NODE_DESCRIPTORS } from './midi.ts';
import type { NodeDescriptor } from './types.ts';

export const DEFAULT_NODE_DESCRIPTORS: readonly NodeDescriptor[] = [
  ...MIDI_NODE_DESCRIPTORS,
  ...AUDIO_NODE_DESCRIPTORS,
  ...CONTROL_NODE_DESCRIPTORS,
  ...CONVERTER_NODE_DESCRIPTORS,
  ...HARDWARE_NODE_DESCRIPTORS
];
