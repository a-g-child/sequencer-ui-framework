import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AudioGraphBuilder,
  BASIC_SYNTH_AUDIO_GRAPH,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  NoopExecutionExecutor,
  createExecutionPlan,
  createNativeExecutionPlan
} from '../src/index.ts';

test('creates an execution plan from a runtime graph', () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  );
  const plan = createExecutionPlan(graph);

  assert.equal(plan.graph, graph);
  assert.deepEqual(
    plan.nodes.map((node) => ({
      nodeId: node.nodeId,
      executionIndex: node.executionIndex
    })),
    [
      { nodeId: 'clip-notes', executionIndex: 0 },
      { nodeId: 'lfo', executionIndex: 1 },
      { nodeId: 'oscillator', executionIndex: 2 },
      { nodeId: 'filter', executionIndex: 3 },
      { nodeId: 'amp-envelope', executionIndex: 4 },
      { nodeId: 'track-gain', executionIndex: 5 },
      { nodeId: 'pan', executionIndex: 6 },
      { nodeId: 'mixer', executionIndex: 7 },
      { nodeId: 'audio-out', executionIndex: 8 }
    ]
  );
  assert.deepEqual(plan.executionBlocks[0], {
    id: 'block-0',
    nodeIds: ['clip-notes']
  });
});

test('defines a no-op execution executor contract', async () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  );
  const executor = new NoopExecutionExecutor();

  assert.equal(executor.status, 'idle');

  await executor.initialise(graph);
  assert.equal(executor.status, 'initialised');

  const result = executor.process({ currentTimeMs: 0 });
  assert.equal(executor.status, 'running');
  assert.deepEqual(result?.nodeDiagnostics, graph.nodeDiagnostics);

  executor.shutdown();
  assert.equal(executor.status, 'shutdown');
});

test('lowers a runtime graph to a native execution plan shape', () => {
  const graph = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(
    BASIC_SYNTH_AUDIO_GRAPH
  );
  const plan = createNativeExecutionPlan(graph);

  assert.equal(plan.graphId, BASIC_SYNTH_AUDIO_GRAPH.id);
  assert.equal(plan.latencySamples, graph.latencySamples);
  assert.ok(plan.buffers.some((buffer) => buffer.id === 'buffer:oscillator:audio-out'));
  assert.ok(plan.parameters.some((parameter) => parameter.id === 'parameter:filter:cutoff'));
  assert.ok(
    plan.eventRoutes.some(
      (route) =>
        route.sourceNodeId === 'clip-notes' &&
        route.sourcePortId === 'midi-out' &&
        route.targetNodeId === 'oscillator' &&
        route.targetPortId === 'midi-in'
    )
  );
  assert.deepEqual(
    plan.executionGroups.map((group) => ({
      rate: group.rate,
      nodeIds: group.nodeIds
    })),
    [
      {
        rate: 'event-rate',
        nodeIds: ['clip-notes']
      },
      {
        rate: 'control-rate',
        nodeIds: ['lfo']
      },
      {
        rate: 'audio-rate',
        nodeIds: [
          'oscillator',
          'filter',
          'amp-envelope',
          'track-gain',
          'pan',
          'mixer',
          'audio-out'
        ]
      }
    ]
  );
});
