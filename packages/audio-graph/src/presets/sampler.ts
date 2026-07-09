import type { AudioGraphDocument } from '../types.ts';

export const SAMPLER_AUDIO_GRAPH: AudioGraphDocument = {
  id: 'preset.sampler',
  version: 1,
  metadata: {
    name: 'Sampler',
    description: 'Graph expression of the current Sequencer Sampler device.'
  },
  nodes: [
    {
      id: 'clip-notes',
      descriptorId: 'sequencer.source.clip-notes',
      name: 'Clip Notes',
      position: { x: 0, y: 0 }
    },
    {
      id: 'sample-player',
      descriptorId: 'sequencer.source.sample-player',
      name: 'Sample Player',
      parameters: { mode: 'pitched' },
      position: { x: 220, y: 0 }
    },
    {
      id: 'track-gain',
      descriptorId: 'sequencer.processor.gain',
      name: 'Track Gain',
      parameters: { gain: 0.8 },
      position: { x: 440, y: 0 }
    },
    {
      id: 'audio-out',
      descriptorId: 'sequencer.output.audio-out',
      name: 'Audio Out',
      position: { x: 660, y: 0 }
    }
  ],
  connections: [
    {
      id: 'clip-notes-to-sample-player',
      source: { nodeId: 'clip-notes', portId: 'midi-out' },
      target: { nodeId: 'sample-player', portId: 'midi-in' }
    },
    {
      id: 'sample-player-to-track-gain',
      source: { nodeId: 'sample-player', portId: 'audio-out' },
      target: { nodeId: 'track-gain', portId: 'audio-in' }
    },
    {
      id: 'track-gain-to-output',
      source: { nodeId: 'track-gain', portId: 'audio-out' },
      target: { nodeId: 'audio-out', portId: 'audio-in' }
    }
  ]
};
