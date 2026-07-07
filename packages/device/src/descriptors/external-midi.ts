import type { DeviceDescriptor } from '../device';

export const EXTERNAL_MIDI_DESCRIPTOR: DeviceDescriptor = {
  id: 'device.external-midi',
  key: 'external-midi',
  name: 'External MIDI',
  manufacturer: 'Sequencer',
  capabilities: ['midi-output'],
  ports: [
    { id: 'midi-out', name: 'MIDI Out', kind: 'midi-out' }
  ],
  parameters: [
    {
      id: 'channel',
      key: 'channel',
      name: 'Channel',
      kind: 'number',
      defaultValue: 1,
      min: 1,
      max: 16,
      step: 1
    }
  ]
};
