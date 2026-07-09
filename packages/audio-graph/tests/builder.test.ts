import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AudioGraphBuilder,
  BASIC_SYNTH_AUDIO_GRAPH,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  SAMPLER_AUDIO_GRAPH
} from '../src/index.ts';

test('builds the Basic Synth graph preset', () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  );

  assert.deepEqual(graph.diagnostics, []);
  assert.equal(graph.nodes.length, 7);
  assert.equal(graph.connections.length, 7);
  assert.deepEqual(graph.executionOrder, [
    'clip-notes',
    'lfo',
    'oscillator',
    'filter',
    'amp-envelope',
    'track-gain',
    'audio-out'
  ]);
});

test('reports incompatible port kinds', () => {
  const document = {
    ...BASIC_SYNTH_AUDIO_GRAPH,
    connections: [
      {
        id: 'bad-kind',
        source: { nodeId: 'clip-notes', portId: 'midi-out' },
        target: { nodeId: 'filter', portId: 'audio-in' }
      }
    ]
  };

  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    document
  );

  assert.equal(graph.connections.length, 0);
  assert.equal(graph.diagnostics[0]?.code, 'incompatible-port-kind');
});

test('builds the Sampler graph preset', () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    SAMPLER_AUDIO_GRAPH
  );

  assert.deepEqual(graph.diagnostics, []);
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.connections.length, 3);
  assert.deepEqual(graph.executionOrder, [
    'clip-notes',
    'sample-player',
    'track-gain',
    'audio-out'
  ]);
});
