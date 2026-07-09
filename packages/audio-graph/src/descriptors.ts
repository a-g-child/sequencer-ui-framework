import type { AudioNodeDescriptor } from './types.ts';

export const CLIP_NOTE_SOURCE_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.source.clip-notes',
  type: 'clip-note-source',
  name: 'Clip Note Source',
  category: 'source',
  ports: [{ id: 'midi-out', name: 'MIDI Out', kind: 'midi', direction: 'output' }]
};

export const MIDI_INPUT_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.source.midi-input',
  type: 'midi-input',
  name: 'MIDI Input',
  category: 'source',
  ports: [{ id: 'midi-out', name: 'MIDI Out', kind: 'midi', direction: 'output' }]
};

export const OSCILLATOR_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.source.oscillator',
  type: 'oscillator',
  name: 'Oscillator',
  category: 'source',
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

export const NOISE_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.source.noise',
  type: 'noise',
  name: 'Noise',
  category: 'source',
  ports: [{ id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output', channels: 1 }]
};

export const AUDIO_FILE_PLAYER_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.source.audio-file-player',
  type: 'audio-file-player',
  name: 'Audio File Player',
  category: 'source',
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output', channels: 2 }
  ]
};

export const SAMPLE_PLAYER_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.source.sample-player',
  type: 'sample-player',
  name: 'Sample Player',
  category: 'source',
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

export const FILTER_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.processor.filter',
  type: 'filter',
  name: 'Filter',
  category: 'processor',
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

export const ADSR_GAIN_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.processor.adsr-gain',
  type: 'adsr-gain',
  name: 'ADSR Gain',
  category: 'processor',
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

export const GAIN_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.processor.gain',
  type: 'gain',
  name: 'Gain',
  category: 'processor',
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' },
    { id: 'gain-mod', name: 'Gain Mod', kind: 'control', direction: 'input' }
  ],
  parameters: [{ id: 'gain', name: 'Gain', kind: 'number', defaultValue: 1, min: 0, max: 2 }]
};

export const PAN_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.processor.pan',
  type: 'pan',
  name: 'Pan',
  category: 'processor',
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output', channels: 2 },
    { id: 'pan-mod', name: 'Pan Mod', kind: 'control', direction: 'input' }
  ],
  parameters: [{ id: 'pan', name: 'Pan', kind: 'number', defaultValue: 0, min: -1, max: 1 }]
};

export const MIXER_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.processor.mixer',
  type: 'mixer',
  name: 'Mixer',
  category: 'processor',
  ports: [
    { id: 'audio-in-a', name: 'Audio In A', kind: 'audio', direction: 'input' },
    { id: 'audio-in-b', name: 'Audio In B', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
  ]
};

export const DELAY_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.processor.delay',
  type: 'delay',
  name: 'Delay',
  category: 'processor',
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
  ],
  parameters: [
    { id: 'time', name: 'Time', kind: 'number', defaultValue: 0.25, min: 0, max: 2, unit: 's' },
    { id: 'feedback', name: 'Feedback', kind: 'number', defaultValue: 0.25, min: 0, max: 0.95 },
    { id: 'mix', name: 'Mix', kind: 'number', defaultValue: 0.25, min: 0, max: 1 }
  ]
};

export const COMPRESSOR_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.processor.compressor',
  type: 'compressor',
  name: 'Compressor',
  category: 'processor',
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
  ]
};

export const LFO_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.control.lfo',
  type: 'lfo',
  name: 'LFO',
  category: 'control',
  ports: [{ id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }],
  parameters: [
    { id: 'rate', name: 'Rate', kind: 'number', defaultValue: 0, min: 0, max: 20, unit: 'Hz' },
    { id: 'depth', name: 'Depth', kind: 'number', defaultValue: 0, min: 0, max: 1 }
  ]
};

export const ENVELOPE_FOLLOWER_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.control.envelope-follower',
  type: 'envelope-follower',
  name: 'Envelope Follower',
  category: 'control',
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }
  ]
};

export const MACRO_KNOB_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.control.macro-knob',
  type: 'macro-knob',
  name: 'Macro Knob',
  category: 'control',
  ports: [{ id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }],
  parameters: [{ id: 'value', name: 'Value', kind: 'number', defaultValue: 0, min: 0, max: 1 }]
};

export const AUTOMATION_INPUT_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.control.automation-input',
  type: 'automation-input',
  name: 'Automation Input',
  category: 'control',
  ports: [{ id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }]
};

export const RANDOM_SAMPLE_HOLD_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.control.random-sample-hold',
  type: 'random-sample-hold',
  name: 'Random Sample & Hold',
  category: 'control',
  ports: [
    { id: 'trigger', name: 'Trigger', kind: 'control', direction: 'input' },
    { id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }
  ]
};

export const AUDIO_OUTPUT_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.output.audio-out',
  type: 'audio-out',
  name: 'Audio Out',
  category: 'output',
  ports: [{ id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input', channels: 2 }]
};

export const MIDI_OUTPUT_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.output.midi-out',
  type: 'midi-out',
  name: 'MIDI Out',
  category: 'output',
  ports: [{ id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' }]
};

export const DEVICE_OUTPUT_DESCRIPTOR: AudioNodeDescriptor = {
  id: 'sequencer.output.device-out',
  type: 'device-out',
  name: 'Device Out',
  category: 'output',
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'control-in', name: 'Control In', kind: 'control', direction: 'input' }
  ]
};

export const DEFAULT_AUDIO_NODE_DESCRIPTORS: readonly AudioNodeDescriptor[] = [
  MIDI_INPUT_DESCRIPTOR,
  CLIP_NOTE_SOURCE_DESCRIPTOR,
  AUDIO_FILE_PLAYER_DESCRIPTOR,
  SAMPLE_PLAYER_DESCRIPTOR,
  OSCILLATOR_DESCRIPTOR,
  NOISE_DESCRIPTOR,
  ADSR_GAIN_DESCRIPTOR,
  FILTER_DESCRIPTOR,
  GAIN_DESCRIPTOR,
  PAN_DESCRIPTOR,
  MIXER_DESCRIPTOR,
  DELAY_DESCRIPTOR,
  COMPRESSOR_DESCRIPTOR,
  LFO_DESCRIPTOR,
  ENVELOPE_FOLLOWER_DESCRIPTOR,
  MACRO_KNOB_DESCRIPTOR,
  AUTOMATION_INPUT_DESCRIPTOR,
  RANDOM_SAMPLE_HOLD_DESCRIPTOR,
  AUDIO_OUTPUT_DESCRIPTOR,
  MIDI_OUTPUT_DESCRIPTOR,
  DEVICE_OUTPUT_DESCRIPTOR
];
