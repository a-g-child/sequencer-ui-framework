import type { NodeDescriptor } from './types.ts';

export const MIDI_NOTE_TO_FREQUENCY_NODE: NodeDescriptor = {
  id: 'sequencer.converter.midi-note-to-frequency',
  type: 'midi-note-to-frequency',
  name: 'MIDI Note To Frequency',
  category: 'converter',
  capabilities: ['converter'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'frequency-out', name: 'Frequency Out', kind: 'control', direction: 'output' }
  ]
};

export const AUDIO_ENVELOPE_TO_CONTROL_NODE: NodeDescriptor = {
  id: 'sequencer.converter.audio-envelope-to-control',
  type: 'audio-envelope-to-control',
  name: 'Audio Envelope To Control',
  category: 'converter',
  capabilities: ['converter'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }
  ]
};

export const CONTROL_TO_AUDIO_TRIGGER_NODE: NodeDescriptor = {
  id: 'sequencer.converter.control-to-audio-trigger',
  type: 'control-to-audio-trigger',
  name: 'Control To Audio Trigger',
  category: 'converter',
  capabilities: ['converter'],
  ports: [
    { id: 'control-in', name: 'Control In', kind: 'control', direction: 'input' },
    { id: 'trigger-out', name: 'Trigger Out', kind: 'trigger', direction: 'output' }
  ]
};

export const CONTROL_TO_CV_NODE: NodeDescriptor = {
  id: 'sequencer.converter.control-to-cv',
  type: 'control-to-cv',
  name: 'Control To CV',
  category: 'converter',
  capabilities: ['converter'],
  ports: [
    { id: 'control-in', name: 'Control In', kind: 'control', direction: 'input' },
    { id: 'cv-out', name: 'CV Out', kind: 'cv', direction: 'output' }
  ]
};

export const MONO_TO_STEREO_NODE: NodeDescriptor = {
  id: 'sequencer.converter.mono-to-stereo',
  type: 'mono-to-stereo',
  name: 'Mono To Stereo',
  category: 'converter',
  capabilities: ['converter'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input', channels: 1 },
    { id: 'audio-out', name: 'Stereo Audio Out', kind: 'stereo-audio', direction: 'output', channels: 2 }
  ]
};

export const STEREO_TO_MONO_NODE: NodeDescriptor = {
  id: 'sequencer.converter.stereo-to-mono',
  type: 'stereo-to-mono',
  name: 'Stereo To Mono',
  category: 'converter',
  capabilities: ['converter'],
  ports: [
    { id: 'audio-in', name: 'Stereo Audio In', kind: 'stereo-audio', direction: 'input', channels: 2 },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output', channels: 1 }
  ]
};

export const CONVERTER_NODE_DESCRIPTORS: readonly NodeDescriptor[] = [
  MIDI_NOTE_TO_FREQUENCY_NODE,
  AUDIO_ENVELOPE_TO_CONTROL_NODE,
  CONTROL_TO_AUDIO_TRIGGER_NODE,
  CONTROL_TO_CV_NODE,
  MONO_TO_STEREO_NODE,
  STEREO_TO_MONO_NODE
];
