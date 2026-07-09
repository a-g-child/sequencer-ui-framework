import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AudioGraphBuilder,
  BASIC_SYNTH_AUDIO_GRAPH,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  SAMPLER_AUDIO_GRAPH,
  type AudioGraphDocument,
  type AudioNodeDescriptor
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

test('accepts matching audio, midi, and control port kinds', () => {
  const graph = new AudioGraphBuilder(PORT_VALIDATION_DESCRIPTORS).build({
    ...PORT_VALIDATION_DOCUMENT,
    connections: [
      {
        id: 'audio-to-audio',
        source: { nodeId: 'audio-source', portId: 'audio-out' },
        target: { nodeId: 'audio-target', portId: 'audio-in' }
      },
      {
        id: 'midi-to-midi',
        source: { nodeId: 'midi-source', portId: 'midi-out' },
        target: { nodeId: 'midi-target', portId: 'midi-in' }
      },
      {
        id: 'control-to-control',
        source: { nodeId: 'control-source', portId: 'control-out' },
        target: { nodeId: 'control-target', portId: 'control-in' }
      }
    ]
  });

  assert.deepEqual(graph.diagnostics, []);
  assert.equal(graph.connections.length, 3);
});

test('rejects mismatched audio, midi, and control port kinds', () => {
  const graph = new AudioGraphBuilder(PORT_VALIDATION_DESCRIPTORS).build({
    ...PORT_VALIDATION_DOCUMENT,
    connections: [
      {
        id: 'midi-to-audio',
        source: { nodeId: 'midi-source', portId: 'midi-out' },
        target: { nodeId: 'audio-target', portId: 'audio-in' }
      },
      {
        id: 'audio-to-control',
        source: { nodeId: 'audio-source', portId: 'audio-out' },
        target: { nodeId: 'control-target', portId: 'control-in' }
      },
      {
        id: 'control-to-midi',
        source: { nodeId: 'control-source', portId: 'control-out' },
        target: { nodeId: 'midi-target', portId: 'midi-in' }
      }
    ]
  });

  assert.equal(graph.connections.length, 0);
  assert.deepEqual(
    graph.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      connectionId: diagnostic.connectionId,
      message: diagnostic.message
    })),
    [
      {
        code: 'incompatible-port-kind',
        connectionId: 'midi-to-audio',
        message: 'Connection "midi-to-audio" cannot connect midi output to audio input.'
      },
      {
        code: 'incompatible-port-kind',
        connectionId: 'audio-to-control',
        message: 'Connection "audio-to-control" cannot connect audio output to control input.'
      },
      {
        code: 'incompatible-port-kind',
        connectionId: 'control-to-midi',
        message: 'Connection "control-to-midi" cannot connect control output to midi input.'
      }
    ]
  );
});

const PORT_VALIDATION_DESCRIPTORS: readonly AudioNodeDescriptor[] = [
  {
    id: 'test.audio-source',
    type: 'audio-source',
    name: 'Audio Source',
    category: 'source',
    ports: [
      { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
    ]
  },
  {
    id: 'test.audio-target',
    type: 'audio-target',
    name: 'Audio Target',
    category: 'processor',
    ports: [
      { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' }
    ]
  },
  {
    id: 'test.midi-source',
    type: 'midi-source',
    name: 'MIDI Source',
    category: 'source',
    ports: [
      { id: 'midi-out', name: 'MIDI Out', kind: 'midi', direction: 'output' }
    ]
  },
  {
    id: 'test.midi-target',
    type: 'midi-target',
    name: 'MIDI Target',
    category: 'processor',
    ports: [
      { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' }
    ]
  },
  {
    id: 'test.control-source',
    type: 'control-source',
    name: 'Control Source',
    category: 'control',
    ports: [
      { id: 'control-out', name: 'Control Out', kind: 'control', direction: 'output' }
    ]
  },
  {
    id: 'test.control-target',
    type: 'control-target',
    name: 'Control Target',
    category: 'processor',
    ports: [
      { id: 'control-in', name: 'Control In', kind: 'control', direction: 'input' }
    ]
  }
];

const PORT_VALIDATION_DOCUMENT: AudioGraphDocument = {
  id: 'test.port-validation',
  version: 1,
  nodes: [
    { id: 'audio-source', descriptorId: 'test.audio-source' },
    { id: 'audio-target', descriptorId: 'test.audio-target' },
    { id: 'midi-source', descriptorId: 'test.midi-source' },
    { id: 'midi-target', descriptorId: 'test.midi-target' },
    { id: 'control-source', descriptorId: 'test.control-source' },
    { id: 'control-target', descriptorId: 'test.control-target' }
  ],
  connections: []
};
