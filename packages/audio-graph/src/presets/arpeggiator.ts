import type { AudioGraphDocument } from '../types.ts';

export const ARPEGGIATOR_MIDI_GRAPH: AudioGraphDocument = {
  id: 'preset.arpeggiator',
  version: 1,
  metadata: {
    name: 'Arpeggiator',
    description: 'Pure MIDI graph expression of the Sequencer Arpeggiator device.'
  },
  nodes: [
    {
      id: 'midi-in',
      descriptorId: 'sequencer.source.midi-input',
      name: 'MIDI In',
      position: { x: 0, y: 0 }
    },
    {
      id: 'arpeggiator',
      descriptorId: 'sequencer.midi.arpeggiator',
      name: 'Arpeggiator',
      parameters: { 'octave-range': 2, rate: '1/16' },
      position: { x: 220, y: 0 }
    },
    {
      id: 'midi-out',
      descriptorId: 'sequencer.output.midi-out',
      name: 'MIDI Out',
      position: { x: 440, y: 0 }
    }
  ],
  connections: [
    {
      id: 'midi-in-to-arpeggiator',
      source: { nodeId: 'midi-in', portId: 'midi-out' },
      target: { nodeId: 'arpeggiator', portId: 'midi-in' }
    },
    {
      id: 'arpeggiator-to-midi-out',
      source: { nodeId: 'arpeggiator', portId: 'midi-out' },
      target: { nodeId: 'midi-out', portId: 'midi-in' }
    }
  ]
};
