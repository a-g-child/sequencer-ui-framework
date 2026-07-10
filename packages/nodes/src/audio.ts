import type { NodeDescriptor } from './types.ts';

export const AUDIO_INPUT_NODE: NodeDescriptor = {
  id: 'sequencer.source.audio-input',
  type: 'audio-input',
  name: 'Audio Input',
  category: 'source',
  capabilities: ['routing'],
  ports: [
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
  ]
};

export const OSCILLATOR_NODE: NodeDescriptor = {
  id: 'sequencer.source.oscillator',
  type: 'oscillator',
  name: 'Oscillator',
  category: 'audio',
  capabilities: ['instrument-source'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output', channels: 1 },
    { id: 'pitch', name: 'Pitch', kind: 'control', direction: 'input' }
  ],
  parameters: [
    {
      id: 'waveform',
      name: 'Waveform',
      kind: 'choice',
      defaultValue: 'sine',
      options: [
        { label: 'Sine', value: 'sine' },
        { label: 'Square', value: 'square' },
        { label: 'Saw', value: 'sawtooth' },
        { label: 'Triangle', value: 'triangle' }
      ]
    }
  ]
};

export const NOISE_NODE: NodeDescriptor = {
  id: 'sequencer.source.noise',
  type: 'noise',
  name: 'Noise',
  category: 'audio',
  capabilities: ['instrument-source'],
  ports: [{ id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output', channels: 1 }]
};

export const AUDIO_FILE_PLAYER_NODE: NodeDescriptor = {
  id: 'sequencer.source.audio-file-player',
  type: 'audio-file-player',
  name: 'Audio File Player',
  category: 'audio',
  capabilities: ['instrument-source'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'stereo-audio', direction: 'output', channels: 2 }
  ]
};

export const SAMPLE_PLAYER_NODE: NodeDescriptor = {
  id: 'sequencer.source.sample-player',
  type: 'sample-player',
  name: 'Sample Player',
  category: 'audio',
  capabilities: ['instrument-source'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
  ],
  parameters: [
    {
      id: 'mode',
      name: 'Mode',
      kind: 'choice',
      defaultValue: 'pitched',
      options: [
        { label: 'Pitched', value: 'pitched' },
        { label: 'Multi', value: 'multi' }
      ]
    }
  ]
};

export const FILTER_NODE: NodeDescriptor = {
  id: 'sequencer.processor.filter',
  type: 'filter',
  name: 'Filter',
  category: 'audio',
  capabilities: ['audio-processor'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' },
    { id: 'cutoff-mod', name: 'Cutoff Mod', kind: 'control', direction: 'input' }
  ],
  parameters: [
    { id: 'cutoff', name: 'Cutoff', kind: 'number', defaultValue: 20000, min: 20, max: 20000, unit: 'Hz' },
    { id: 'resonance', name: 'Resonance', kind: 'number', defaultValue: 0, min: 0, max: 20 }
  ]
};

export const ADSR_GAIN_NODE: NodeDescriptor = {
  id: 'sequencer.processor.adsr-gain',
  type: 'adsr-gain',
  name: 'ADSR Gain',
  category: 'audio',
  capabilities: ['audio-processor', 'modulation'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
  ],
  parameters: [
    { id: 'attack', name: 'Attack', kind: 'number', defaultValue: 10, min: 0, max: 3000, unit: 'ms' },
    { id: 'decay', name: 'Decay', kind: 'number', defaultValue: 150, min: 0, max: 3000, unit: 'ms' },
    { id: 'sustain', name: 'Sustain', kind: 'number', defaultValue: 0.7, min: 0, max: 1 },
    { id: 'release', name: 'Release', kind: 'number', defaultValue: 200, min: 0, max: 3000, unit: 'ms' },
    { id: 'velocity-to-amp', name: 'Velocity', kind: 'number', defaultValue: 1, min: 0, max: 1 }
  ]
};

export const GAIN_NODE: NodeDescriptor = {
  id: 'sequencer.processor.gain',
  type: 'gain',
  name: 'Gain',
  category: 'audio',
  capabilities: ['audio-processor'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' },
    { id: 'gain-mod', name: 'Gain Mod', kind: 'control', direction: 'input' }
  ],
  parameters: [{ id: 'gain', name: 'Gain', kind: 'number', defaultValue: 1, min: 0, max: 2 }]
};

export const PAN_NODE: NodeDescriptor = {
  id: 'sequencer.processor.pan',
  type: 'pan',
  name: 'Pan',
  category: 'audio',
  capabilities: ['audio-processor'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output', channels: 2 },
    { id: 'pan-mod', name: 'Pan Mod', kind: 'control', direction: 'input' }
  ],
  parameters: [{ id: 'pan', name: 'Pan', kind: 'number', defaultValue: 0, min: -1, max: 1 }]
};

export const MIXER_NODE: NodeDescriptor = {
  id: 'sequencer.processor.mixer',
  type: 'mixer',
  name: 'Mixer',
  category: 'audio',
  capabilities: ['audio-processor', 'routing'],
  ports: [
    { id: 'audio-in-a', name: 'Audio In A', kind: 'audio', direction: 'input' },
    { id: 'audio-in-b', name: 'Audio In B', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
  ]
};

export const DELAY_NODE: NodeDescriptor = {
  id: 'sequencer.processor.delay',
  type: 'delay',
  name: 'Delay',
  category: 'audio',
  capabilities: ['audio-processor'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
  ],
  parameters: [
    { id: 'time', name: 'Time', kind: 'number', defaultValue: 0.25, min: 0, max: 2, unit: 's' },
    {
      id: 'time-mode',
      name: 'Mode',
      kind: 'choice',
      defaultValue: 'free',
      options: [
        { label: 'Free', value: 'free' },
        { label: 'Sync', value: 'sync' }
      ]
    },
    {
      id: 'sync-division',
      name: 'Division',
      kind: 'choice',
      defaultValue: '1/8',
      options: [
        { label: '1/4', value: '1/4' },
        { label: '1/4.', value: '1/4.' },
        { label: '1/4T', value: '1/4T' },
        { label: '1/8', value: '1/8' },
        { label: '1/8.', value: '1/8.' },
        { label: '1/8T', value: '1/8T' },
        { label: '1/16', value: '1/16' },
        { label: '1/16.', value: '1/16.' },
        { label: '1/16T', value: '1/16T' }
      ]
    },
    { id: 'feedback', name: 'Feedback', kind: 'number', defaultValue: 0.25, min: 0, max: 0.95 },
    { id: 'mix', name: 'Mix', kind: 'number', defaultValue: 0.25, min: 0, max: 1 }
  ]
};

export const COMPRESSOR_NODE: NodeDescriptor = {
  id: 'sequencer.processor.compressor',
  type: 'compressor',
  name: 'Compressor',
  category: 'audio',
  capabilities: ['audio-processor'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
  ]
};

export const REVERB_NODE: NodeDescriptor = {
  id: 'sequencer.processor.reverb',
  type: 'reverb',
  name: 'Reverb',
  category: 'audio',
  capabilities: ['audio-processor'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
  ],
  parameters: [
    { id: 'decay', name: 'Decay', kind: 'number', defaultValue: 1.5, min: 0.1, max: 20, unit: 's' },
    { id: 'mix', name: 'Mix', kind: 'number', defaultValue: 0.25, min: 0, max: 1 }
  ]
};

export const AUDIO_OUTPUT_NODE: NodeDescriptor = {
  id: 'sequencer.output.audio-out',
  type: 'audio-out',
  name: 'Audio Out',
  category: 'output',
  capabilities: ['routing'],
  ports: [{ id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input', channels: 2 }]
};

export const AUDIO_NODE_DESCRIPTORS: readonly NodeDescriptor[] = [
  AUDIO_INPUT_NODE,
  AUDIO_FILE_PLAYER_NODE,
  SAMPLE_PLAYER_NODE,
  OSCILLATOR_NODE,
  NOISE_NODE,
  ADSR_GAIN_NODE,
  FILTER_NODE,
  GAIN_NODE,
  PAN_NODE,
  MIXER_NODE,
  DELAY_NODE,
  COMPRESSOR_NODE,
  REVERB_NODE,
  AUDIO_OUTPUT_NODE
];
