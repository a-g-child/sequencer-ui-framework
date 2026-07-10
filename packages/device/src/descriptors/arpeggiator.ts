import { ARPEGGIATOR_MIDI_GRAPH } from '@sequencer/audio-graph';
import type { DeviceDescriptor } from '../device.ts';

export const ARPEGGIATOR_DESCRIPTOR: DeviceDescriptor = {
  id: 'device.arpeggiator',
  key: 'arpeggiator',
  name: 'Arpeggiator',
  manufacturer: 'Sequencer',
  capabilities: ['midi-effect', 'automation-target'],
  graphPreset: ARPEGGIATOR_MIDI_GRAPH,
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi-in' },
    { id: 'midi-out', name: 'MIDI Out', kind: 'midi-out' }
  ],
  parameters: [
    {
      id: 'octave-range',
      key: 'octaveRange',
      name: 'Octaves',
      kind: 'number',
      defaultValue: 2,
      min: 1,
      max: 4,
      step: 1
    },
    {
      id: 'rate',
      key: 'rate',
      name: 'Rate',
      kind: 'choice',
      defaultValue: '1/16',
      options: [
        { label: '1/8', value: '1/8' },
        { label: '1/16', value: '1/16' },
        { label: '1/32', value: '1/32' }
      ]
    }
  ]
};
