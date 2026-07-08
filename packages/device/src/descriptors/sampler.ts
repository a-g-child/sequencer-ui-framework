import type { DeviceDescriptor } from '../device.ts';

export type SamplerDeviceDescriptor = DeviceDescriptor & {
  key: 'sampler';
};

export const SAMPLER_DESCRIPTOR: SamplerDeviceDescriptor = {
  id: 'device.sampler',
  key: 'sampler',
  name: 'Sampler',
  manufacturer: 'Sequencer',
  capabilities: ['instrument', 'sampler', 'automation-target'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi-in' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio-out', channels: 2 }
  ],
  parameters: [
    {
      id: 'mode',
      key: 'mode',
      name: 'Mode',
      kind: 'choice',
      defaultValue: 'pitched',
      options: [
        { label: 'Pitched', value: 'pitched' },
        { label: 'Multi', value: 'multi' }
      ]
    },
    {
      id: 'volume',
      key: 'volume',
      name: 'Volume',
      kind: 'number',
      defaultValue: 0.8,
      min: 0,
      max: 1,
      step: 0.01
    }
  ]
};
