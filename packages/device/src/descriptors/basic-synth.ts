import type { DeviceDescriptor } from '../device';

export const BASIC_SYNTH_DESCRIPTOR: DeviceDescriptor = {
  id: 'device.basic-synth',
  key: 'basic-synth',
  name: 'Basic Synth',
  manufacturer: 'Sequencer',
  capabilities: ['instrument', 'automation-target'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi-in' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio-out', channels: 2 }
  ],
  parameters: [
    {
      id: 'waveform',
      key: 'waveform',
      name: 'Waveform',
      kind: 'choice',
      defaultValue: 'sine',
      options: [
        { label: 'Sine', value: 'sine' },
        { label: 'Square', value: 'square' },
        { label: 'Saw', value: 'sawtooth' },
        { label: 'Triangle', value: 'triangle' }
      ]
    },
    {
      id: 'volume',
      key: 'volume',
      name: 'Volume',
      kind: 'number',
      defaultValue: 0.25,
      min: 0,
      max: 1,
      step: 0.01
    },
    {
      id: 'velocity-to-amp',
      key: 'velocityToAmp',
      name: 'Velocity',
      kind: 'number',
      defaultValue: 1,
      min: 0,
      max: 1,
      step: 0.01
    },
    {
      id: 'attack',
      key: 'attack',
      name: 'Attack',
      kind: 'number',
      defaultValue: 0.01,
      min: 0,
      max: 5,
      step: 0.01,
      unit: 's'
    },
    {
      id: 'decay',
      key: 'decay',
      name: 'Decay',
      kind: 'number',
      defaultValue: 0.15,
      min: 0,
      max: 5,
      step: 0.01,
      unit: 's'
    },
    {
      id: 'sustain',
      key: 'sustain',
      name: 'Sustain',
      kind: 'number',
      defaultValue: 0.7,
      min: 0,
      max: 1,
      step: 0.01
    },
    {
      id: 'release',
      key: 'release',
      name: 'Release',
      kind: 'number',
      defaultValue: 0.2,
      min: 0,
      max: 10,
      step: 0.01,
      unit: 's'
    }
  ]
};
