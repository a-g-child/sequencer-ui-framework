import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SAMPLER_AUDIO_GRAPH } from '@sequencer/audio-graph';
import { SAMPLER_DESCRIPTOR } from '../src/descriptors/sampler.ts';
import { SamplerFactory } from '../src/factories/sampler.ts';
import type { SamplerDeviceInstance } from '../src/factories/sampler.ts';
import { getRuntimeParameter } from '../src/parameter-runtime.ts';

const samplerInstance: SamplerDeviceInstance = {
  id: 'sampler-1',
  descriptorKey: SAMPLER_DESCRIPTOR.key,
  name: 'Sampler',
  parameterValues: {
    mode: 'multi',
    volume: 0.5
  },
  sampleSlots: [
    {
      id: 'kick',
      name: 'Kick',
      assetId: 'asset-kick',
      rootNote: 36,
      gain: 1,
      start: 0,
      loop: false
    }
  ]
};

describe('Sampler graph preset', () => {
  it('advertises the graph document on the descriptor', () => {
    assert.equal(SAMPLER_DESCRIPTOR.graphPreset, SAMPLER_AUDIO_GRAPH);
  });

  it('builds a runtime graph while keeping runtime parameters intact', () => {
    const device = new SamplerFactory().create(samplerInstance);

    assert.equal(device.runtimeGraph?.document.id, SAMPLER_AUDIO_GRAPH.id);
    assert.equal(device.runtimeGraph?.nodes.length, 4);
    assert.equal(device.runtimeGraph?.connections.length, 3);
    assert.deepEqual(device.runtimeGraph?.diagnostics, []);
    assert.deepEqual(
      device.runtimeGraph?.nodes.map((node) => node.descriptor.id),
      [
        'sequencer.source.clip-notes',
        'sequencer.source.sample-player',
        'sequencer.processor.gain',
        'sequencer.output.audio-out'
      ]
    );
    assert.equal(getRuntimeParameter(device.parameters, 'mode')?.value, 'multi');
    assert.equal(getRuntimeParameter(device.parameters, 'volume')?.value, 0.5);
  });

  it('keeps sample voice actions unchanged', () => {
    const device = new SamplerFactory().create(samplerInstance);

    device.processEvents([
      {
        type: 'note:on',
        noteId: 'note-1',
        destination: { trackId: 'track-1' },
        pitch: 36,
        velocity: 0.75,
        timeMs: 100
      }
    ]);

    assert.deepEqual(device.consumeSampleActions(), [
      {
        type: 'sample:start',
        voiceId: 'voice-1',
        trackId: 'track-1',
        noteId: 'note-1',
        assetId: 'asset-kick',
        pitch: 36,
        velocity: 0.75,
        playbackRate: 1,
        gain: 0.375,
        startSeconds: 0,
        endSeconds: undefined,
        loopEnabled: false,
        loopStartSeconds: 0,
        loopEndSeconds: undefined,
        timeMs: 100
      }
    ]);

    assert.deepEqual(device.getDiagnostics().graph, {
      presetId: SAMPLER_AUDIO_GRAPH.id,
      nodeCount: 4,
      connectionCount: 3,
      latencySamples: 0,
      executionOrder: ['clip-notes', 'sample-player', 'track-gain', 'audio-out'],
      diagnostics: [],
      nodeDiagnostics: [
        {
          nodeId: 'clip-notes',
          descriptorId: 'sequencer.source.clip-notes',
          executionIndex: 0,
          latencySamples: 0
        },
        {
          nodeId: 'sample-player',
          descriptorId: 'sequencer.source.sample-player',
          executionIndex: 1,
          latencySamples: 0
        },
        {
          nodeId: 'track-gain',
          descriptorId: 'sequencer.processor.gain',
          executionIndex: 2,
          latencySamples: 0
        },
        {
          nodeId: 'audio-out',
          descriptorId: 'sequencer.output.audio-out',
          executionIndex: 3,
          latencySamples: 0
        }
      ]
    });
  });
});
