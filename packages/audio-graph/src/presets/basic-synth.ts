import type { AudioGraphDocument } from '../types.ts';

export const BASIC_SYNTH_AUDIO_GRAPH: AudioGraphDocument = {
  id: 'preset.basic-synth',
  version: 1,
  metadata: {
    name: 'Basic Synth',
    description: 'Graph expression of the current Sequencer Basic Synth device.'
  },
  nodes: [
    {
      id: 'clip-notes',
      descriptorId: 'sequencer.source.clip-notes',
      name: 'Clip Notes',
      position: { x: 0, y: 0 }
    },
    {
      id: 'oscillator',
      descriptorId: 'sequencer.source.oscillator',
      name: 'Oscillator',
      parameters: { waveform: 'sine' },
      position: { x: 220, y: 0 }
    },
    {
      id: 'filter',
      descriptorId: 'sequencer.processor.filter',
      name: 'Filter',
      parameters: { cutoff: 20000, resonance: 0 },
      position: { x: 440, y: 0 }
    },
    {
      id: 'amp-envelope',
      descriptorId: 'sequencer.processor.adsr-gain',
      name: 'ADSR Gain',
      parameters: {
        attack: 10,
        decay: 150,
        sustain: 0.7,
        release: 200,
        'velocity-to-amp': 1
      },
      position: { x: 660, y: 0 }
    },
    {
      id: 'track-gain',
      descriptorId: 'sequencer.processor.gain',
      name: 'Track Gain',
      parameters: { gain: 0.25 },
      position: { x: 880, y: 0 }
    },
    {
      id: 'audio-out',
      descriptorId: 'sequencer.output.audio-out',
      name: 'Audio Out',
      position: { x: 1100, y: 0 }
    },
    {
      id: 'lfo',
      descriptorId: 'sequencer.control.lfo',
      name: 'LFO',
      parameters: { rate: 0, depth: 0 },
      position: { x: 220, y: 180 }
    }
  ],
  connections: [
    {
      id: 'clip-notes-to-oscillator',
      source: { nodeId: 'clip-notes', portId: 'midi-out' },
      target: { nodeId: 'oscillator', portId: 'midi-in' }
    },
    {
      id: 'clip-notes-to-envelope',
      source: { nodeId: 'clip-notes', portId: 'midi-out' },
      target: { nodeId: 'amp-envelope', portId: 'midi-in' }
    },
    {
      id: 'oscillator-to-filter',
      source: { nodeId: 'oscillator', portId: 'audio-out' },
      target: { nodeId: 'filter', portId: 'audio-in' }
    },
    {
      id: 'filter-to-envelope',
      source: { nodeId: 'filter', portId: 'audio-out' },
      target: { nodeId: 'amp-envelope', portId: 'audio-in' }
    },
    {
      id: 'envelope-to-track-gain',
      source: { nodeId: 'amp-envelope', portId: 'audio-out' },
      target: { nodeId: 'track-gain', portId: 'audio-in' }
    },
    {
      id: 'track-gain-to-output',
      source: { nodeId: 'track-gain', portId: 'audio-out' },
      target: { nodeId: 'audio-out', portId: 'audio-in' }
    },
    {
      id: 'lfo-to-filter-cutoff',
      source: { nodeId: 'lfo', portId: 'control-out' },
      target: { nodeId: 'filter', portId: 'cutoff-mod' }
    }
  ]
};
