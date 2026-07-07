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
    }
  ]
};
