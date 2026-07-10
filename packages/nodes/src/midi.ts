import type { NodeDescriptor } from './types.ts';

export const MIDI_INPUT_NODE: NodeDescriptor = {
  id: 'sequencer.source.midi-input',
  type: 'midi-input',
  name: 'MIDI Input',
  category: 'midi',
  capabilities: ['instrument-source'],
  ports: [{ id: 'midi-out', name: 'MIDI Out', kind: 'midi', direction: 'output' }]
};

export const CLIP_NOTE_SOURCE_NODE: NodeDescriptor = {
  id: 'sequencer.source.clip-notes',
  type: 'clip-note-source',
  name: 'Clip Note Source',
  category: 'midi',
  capabilities: ['instrument-source'],
  ports: [{ id: 'midi-out', name: 'MIDI Out', kind: 'midi', direction: 'output' }]
};

export const MIDI_FILTER_NODE: NodeDescriptor = {
  id: 'sequencer.midi.filter',
  type: 'midi-filter',
  name: 'MIDI Filter',
  category: 'midi',
  capabilities: ['midi-processor'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'midi-out', name: 'MIDI Out', kind: 'midi', direction: 'output' }
  ]
};

export const MIDI_CHANNEL_NODE: NodeDescriptor = {
  id: 'sequencer.midi.channel',
  type: 'midi-channel',
  name: 'MIDI Channel',
  category: 'midi',
  capabilities: ['midi-processor'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'midi-out', name: 'MIDI Out', kind: 'midi', direction: 'output' }
  ],
  parameters: [{ id: 'channel', name: 'Channel', kind: 'number', defaultValue: 1, min: 1, max: 16, step: 1 }]
};

export const MIDI_TRANSPOSE_NODE: NodeDescriptor = {
  id: 'sequencer.midi.transpose',
  type: 'midi-transpose',
  name: 'MIDI Transpose',
  category: 'midi',
  capabilities: ['midi-processor'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'midi-out', name: 'MIDI Out', kind: 'midi', direction: 'output' }
  ],
  parameters: [{ id: 'semitones', name: 'Semitones', kind: 'number', defaultValue: 0, min: -48, max: 48, step: 1 }]
};

export const MIDI_ARPEGGIATOR_NODE: NodeDescriptor = {
  id: 'sequencer.midi.arpeggiator',
  type: 'midi-arpeggiator',
  name: 'Arpeggiator',
  category: 'midi',
  capabilities: ['midi-processor', 'timing'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'midi-out', name: 'MIDI Out', kind: 'midi', direction: 'output' }
  ],
  parameters: [
    {
      id: 'octave-range',
      name: 'Octaves',
      kind: 'number',
      defaultValue: 2,
      min: 1,
      max: 4,
      step: 1
    },
    {
      id: 'rate',
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

export const MIDI_SPLIT_NODE: NodeDescriptor = {
  id: 'sequencer.midi.split',
  type: 'midi-split',
  name: 'MIDI Split',
  category: 'midi',
  capabilities: ['midi-processor', 'routing'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'midi-out-a', name: 'MIDI Out A', kind: 'midi', direction: 'output' },
    { id: 'midi-out-b', name: 'MIDI Out B', kind: 'midi', direction: 'output' }
  ]
};

export const MIDI_MERGE_NODE: NodeDescriptor = {
  id: 'sequencer.midi.merge',
  type: 'midi-merge',
  name: 'MIDI Merge',
  category: 'midi',
  capabilities: ['midi-processor', 'routing'],
  ports: [
    { id: 'midi-in-a', name: 'MIDI In A', kind: 'midi', direction: 'input' },
    { id: 'midi-in-b', name: 'MIDI In B', kind: 'midi', direction: 'input' },
    { id: 'midi-out', name: 'MIDI Out', kind: 'midi', direction: 'output' }
  ]
};

export const MIDI_OUTPUT_NODE: NodeDescriptor = {
  id: 'sequencer.output.midi-out',
  type: 'midi-out',
  name: 'MIDI Out',
  category: 'output',
  capabilities: ['routing'],
  ports: [{ id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' }]
};

export const MIDI_NODE_DESCRIPTORS: readonly NodeDescriptor[] = [
  MIDI_INPUT_NODE,
  CLIP_NOTE_SOURCE_NODE,
  MIDI_FILTER_NODE,
  MIDI_CHANNEL_NODE,
  MIDI_TRANSPOSE_NODE,
  MIDI_ARPEGGIATOR_NODE,
  MIDI_SPLIT_NODE,
  MIDI_MERGE_NODE,
  MIDI_OUTPUT_NODE
];
