import type { AudioGraphDocument } from '../types.ts';

export const DELAY_AUDIO_GRAPH: AudioGraphDocument = {
  id: 'preset.delay',
  version: 1,
  metadata: {
    name: 'Delay',
    description: 'Graph expression of a post-instrument audio delay effect.'
  },
  nodes: [
    {
      id: 'audio-in',
      descriptorId: 'sequencer.source.audio-input',
      name: 'Audio In',
      position: { x: 0, y: 0 }
    },
    {
      id: 'delay',
      descriptorId: 'sequencer.processor.delay',
      name: 'Delay',
      parameters: {
        time: 0.25,
        'time-mode': 'free',
        'sync-division': '1/8',
        feedback: 0.25,
        mix: 0.25
      },
      position: { x: 220, y: 0 }
    },
    {
      id: 'audio-out',
      descriptorId: 'sequencer.output.audio-out',
      name: 'Audio Out',
      position: { x: 440, y: 0 }
    }
  ],
  connections: [
    {
      id: 'audio-in-to-delay',
      source: { nodeId: 'audio-in', portId: 'audio-out' },
      target: { nodeId: 'delay', portId: 'audio-in' }
    },
    {
      id: 'delay-to-output',
      source: { nodeId: 'delay', portId: 'audio-out' },
      target: { nodeId: 'audio-out', portId: 'audio-in' }
    }
  ]
};
