import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AudioGraphBuilder,
  ARPEGGIATOR_MIDI_GRAPH,
  BASIC_SYNTH_AUDIO_GRAPH,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  DELAY_AUDIO_GRAPH,
  SAMPLER_AUDIO_GRAPH,
  buildDeviceChainGraph,
  type AudioGraphDocument,
  type AudioNodeDescriptor
} from '../src/index.ts';

test('builds the Basic Synth graph preset', () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  );

  assert.deepEqual(graph.diagnostics, []);
  assert.equal(graph.nodes.length, 9);
  assert.equal(graph.connections.length, 9);
  assert.deepEqual(graph.executionOrder, [
    'clip-notes',
    'lfo',
    'oscillator',
    'filter',
    'amp-envelope',
    'track-gain',
    'pan',
    'mixer',
    'audio-out'
  ]);
  assert.deepEqual(
    graph.nodes.map((node) => ({
      id: node.id,
      descriptorId: node.descriptorId,
      executionIndex: node.executionIndex
    })),
    [
      {
        id: 'clip-notes',
        descriptorId: 'sequencer.source.clip-notes',
        executionIndex: 0
      },
      {
        id: 'oscillator',
        descriptorId: 'sequencer.source.oscillator',
        executionIndex: 2
      },
      {
        id: 'filter',
        descriptorId: 'sequencer.processor.filter',
        executionIndex: 3
      },
      {
        id: 'amp-envelope',
        descriptorId: 'sequencer.processor.adsr-gain',
        executionIndex: 4
      },
      {
        id: 'track-gain',
        descriptorId: 'sequencer.processor.gain',
        executionIndex: 5
      },
      {
        id: 'pan',
        descriptorId: 'sequencer.processor.pan',
        executionIndex: 6
      },
      {
        id: 'mixer',
        descriptorId: 'sequencer.processor.mixer',
        executionIndex: 7
      },
      {
        id: 'audio-out',
        descriptorId: 'sequencer.output.audio-out',
        executionIndex: 8
      },
      {
        id: 'lfo',
        descriptorId: 'sequencer.control.lfo',
        executionIndex: 1
      }
    ]
  );
  assert.deepEqual(
    graph.nodes.find((node) => node.id === 'filter')?.resolvedPorts,
    {
      inputs: [
        { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
        { id: 'cutoff-mod', name: 'Cutoff Mod', kind: 'control', direction: 'input' }
      ],
      outputs: [
        { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' }
      ]
    }
  );
  assert.equal(
    graph.connections.find((connection) => connection.connection.id === 'oscillator-to-filter')
      ?.sourceNode.executionIndex,
    2
  );
  assert.deepEqual(
    graph.nodeDiagnostics.map((diagnostic) => ({
      nodeId: diagnostic.nodeId,
      descriptorId: diagnostic.descriptorId,
      executionIndex: diagnostic.executionIndex,
      latencySamples: diagnostic.latencySamples,
      lastProcessMs: diagnostic.lastProcessMs,
      averageProcessMs: diagnostic.averageProcessMs,
      peakProcessMs: diagnostic.peakProcessMs
    })),
    [
      {
        nodeId: 'clip-notes',
        descriptorId: 'sequencer.source.clip-notes',
        executionIndex: 0,
        latencySamples: 0,
        lastProcessMs: undefined,
        averageProcessMs: undefined,
        peakProcessMs: undefined
      },
      {
        nodeId: 'oscillator',
        descriptorId: 'sequencer.source.oscillator',
        executionIndex: 2,
        latencySamples: 0,
        lastProcessMs: undefined,
        averageProcessMs: undefined,
        peakProcessMs: undefined
      },
      {
        nodeId: 'filter',
        descriptorId: 'sequencer.processor.filter',
        executionIndex: 3,
        latencySamples: 0,
        lastProcessMs: undefined,
        averageProcessMs: undefined,
        peakProcessMs: undefined
      },
      {
        nodeId: 'amp-envelope',
        descriptorId: 'sequencer.processor.adsr-gain',
        executionIndex: 4,
        latencySamples: 0,
        lastProcessMs: undefined,
        averageProcessMs: undefined,
        peakProcessMs: undefined
      },
      {
        nodeId: 'track-gain',
        descriptorId: 'sequencer.processor.gain',
        executionIndex: 5,
        latencySamples: 0,
        lastProcessMs: undefined,
        averageProcessMs: undefined,
        peakProcessMs: undefined
      },
      {
        nodeId: 'pan',
        descriptorId: 'sequencer.processor.pan',
        executionIndex: 6,
        latencySamples: 0,
        lastProcessMs: undefined,
        averageProcessMs: undefined,
        peakProcessMs: undefined
      },
      {
        nodeId: 'mixer',
        descriptorId: 'sequencer.processor.mixer',
        executionIndex: 7,
        latencySamples: 0,
        lastProcessMs: undefined,
        averageProcessMs: undefined,
        peakProcessMs: undefined
      },
      {
        nodeId: 'audio-out',
        descriptorId: 'sequencer.output.audio-out',
        executionIndex: 8,
        latencySamples: 0,
        lastProcessMs: undefined,
        averageProcessMs: undefined,
        peakProcessMs: undefined
      },
      {
        nodeId: 'lfo',
        descriptorId: 'sequencer.control.lfo',
        executionIndex: 1,
        latencySamples: 0,
        lastProcessMs: undefined,
        averageProcessMs: undefined,
        peakProcessMs: undefined
      }
    ]
  );
});

test('builds the Arpeggiator MIDI graph preset', () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    ARPEGGIATOR_MIDI_GRAPH
  );

  assert.deepEqual(graph.diagnostics, []);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.connections.length, 2);
  assert.deepEqual(graph.executionOrder, [
    'midi-in',
    'arpeggiator',
    'midi-out'
  ]);
});

test('builds the Sampler graph preset', () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    SAMPLER_AUDIO_GRAPH
  );

  assert.deepEqual(graph.diagnostics, []);
  assert.equal(graph.nodes.length, 7);
  assert.equal(graph.connections.length, 7);
  assert.deepEqual(graph.executionOrder, [
    'clip-notes',
    'sample-player',
    'amp-envelope',
    'track-gain',
    'pan',
    'mixer',
    'audio-out'
  ]);
});

test('builds the Delay audio effect graph preset', () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    DELAY_AUDIO_GRAPH
  );

  assert.deepEqual(graph.diagnostics, []);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.connections.length, 2);
  assert.deepEqual(graph.executionOrder, [
    'audio-in',
    'delay',
    'audio-out'
  ]);
});

test('composes a track device chain graph from device graph fragments', () => {
  const document = buildDeviceChainGraph({
    id: 'track.track-1.chain',
    name: 'Track 1 Chain',
    fragments: [
      { id: 'arp-1', graph: ARPEGGIATOR_MIDI_GRAPH },
      { id: 'sampler-1', graph: SAMPLER_AUDIO_GRAPH },
      { id: 'delay-1', graph: DELAY_AUDIO_GRAPH }
    ]
  });
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    document
  );

  assert.deepEqual(graph.diagnostics, []);
  assert.deepEqual(
    document.nodes.map((node) => node.id),
    [
      'track-midi-in',
      'arp-1.arpeggiator',
      'sampler-1.sample-player',
      'sampler-1.amp-envelope',
      'sampler-1.track-gain',
      'sampler-1.pan',
      'sampler-1.mixer',
      'delay-1.delay',
      'track-audio-out'
    ]
  );
  assert.ok(
    document.connections.some(
      (connection) =>
        connection.source.nodeId === 'arp-1.arpeggiator' &&
        connection.source.portId === 'midi-out' &&
        connection.target.nodeId === 'sampler-1.sample-player' &&
        connection.target.portId === 'midi-in'
    )
  );
  assert.ok(
    document.connections.some(
      (connection) =>
        connection.source.nodeId === 'sampler-1.mixer' &&
        connection.source.portId === 'audio-out' &&
        connection.target.nodeId === 'delay-1.delay' &&
        connection.target.portId === 'audio-in'
    )
  );
  assert.ok(
    document.connections.some(
      (connection) =>
        connection.source.nodeId === 'delay-1.delay' &&
        connection.source.portId === 'audio-out' &&
        connection.target.nodeId === 'track-audio-out' &&
        connection.target.portId === 'audio-in'
    )
  );
  assert.equal(graph.nodes.length, 9);
  assert.equal(graph.connections.length, 9);
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

test('allows type conversion through explicit converter nodes', () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build({
    id: 'test.converter',
    version: 1,
    nodes: [
      { id: 'clip-notes', descriptorId: 'sequencer.source.clip-notes' },
      {
        id: 'note-to-frequency',
        descriptorId: 'sequencer.converter.midi-note-to-frequency'
      },
      { id: 'filter', descriptorId: 'sequencer.processor.filter' }
    ],
    connections: [
      {
        id: 'midi-to-converter',
        source: { nodeId: 'clip-notes', portId: 'midi-out' },
        target: { nodeId: 'note-to-frequency', portId: 'midi-in' }
      },
      {
        id: 'converter-to-cutoff',
        source: { nodeId: 'note-to-frequency', portId: 'frequency-out' },
        target: { nodeId: 'filter', portId: 'cutoff-mod' }
      }
    ]
  });

  assert.deepEqual(graph.diagnostics, []);
  assert.equal(graph.connections.length, 2);
  assert.deepEqual(graph.executionOrder, [
    'clip-notes',
    'note-to-frequency',
    'filter'
  ]);
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
