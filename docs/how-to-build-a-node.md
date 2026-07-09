# How To Build A Node

This guide is for adding a reusable execution node to Sequencer.

A node is a musical execution primitive, not a WebAudio primitive. WebAudio,
native audio, WASM, MIDI, and hardware executors can all implement the same node
descriptor differently.

```text
NodeDescriptor
  -> graph document node
  -> RuntimeNode
  -> executor materialisation
```

## 1. Choose The Node Role

Name the node by its execution role:

- `oscillator`
- `sample-player`
- `filter`
- `adsr-gain`
- `gain`
- `pan`
- `mixer`
- `delay`
- `lfo`
- `midi-transpose`
- `cv-output`

Avoid backend names. A node should describe what the graph means, not which API
will run it.

## 2. Add A Node Descriptor

Node descriptors live in `packages/nodes`.

Current files are grouped by signal family:

- `packages/nodes/src/audio.ts`
- `packages/nodes/src/midi.ts`
- `packages/nodes/src/control.ts`
- `packages/nodes/src/converters.ts`
- `packages/nodes/src/hardware.ts`

A descriptor defines:

- stable `id`
- `type`
- display `name`
- `category`
- `capabilities`
- typed `ports`
- default `parameters`
- optional `latencySamples`

Example shape:

```ts
export const GAIN_NODE: NodeDescriptor = {
  id: 'sequencer.processor.gain',
  type: 'gain',
  name: 'Gain',
  category: 'audio',
  capabilities: ['audio-processor'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'audio-out', name: 'Audio Out', kind: 'audio', direction: 'output' },
    { id: 'gain-mod', name: 'Gain Mod', kind: 'control', direction: 'input' }
  ],
  parameters: [
    { id: 'gain', name: 'Gain', kind: 'number', defaultValue: 1, min: 0, max: 2 }
  ]
};
```

Add the descriptor to the relevant descriptor array and export it from
`packages/nodes/src/index.ts` if needed.

## 3. Define Ports Carefully

Ports are the safety contract.

Supported signal kinds currently include:

- `audio`
- `stereo-audio`
- `midi`
- `gate`
- `trigger`
- `control`
- `boolean`
- `cv`
- `gpio`
- `serial`
- `network`
- `lighting`

Use direct compatible ports for direct connections. Use converter nodes for
intentional conversions such as MIDI to control, audio to control, or control to
hardware CV.

Port ids should be stable and specific:

- `audio-in`
- `audio-out`
- `midi-in`
- `midi-out`
- `cutoff-mod`
- `gain-mod`
- `pan-mod`

## 4. Define Parameters

Parameters should describe node-local behavior:

- oscillator waveform
- filter cutoff and resonance
- gain amount
- pan position
- delay time and feedback
- LFO rate and depth

Use simple default values. Device descriptors can expose higher-level runtime
parameters and bind them to graph node parameters later.

## 5. Use The Node In A Graph Preset

Add the node to a graph preset in `packages/audio-graph/src/presets`.

A graph document node references the descriptor with `descriptorId`:

```ts
{
  id: 'track-gain',
  descriptorId: 'sequencer.processor.gain',
  name: 'Track Gain',
  parameters: { gain: 0.8 }
}
```

Connections reference port ids:

```ts
{
  id: 'gain-to-pan',
  source: { nodeId: 'track-gain', portId: 'audio-out' },
  target: { nodeId: 'pan', portId: 'audio-in' }
}
```

The graph builder resolves descriptors, ports, parameters, execution order, and
diagnostics.

## 6. Add Executor Support

Executor support currently lives in `packages/playback/src/output/WebAudioExecutor.ts`.

The executor should materialise node roles:

```text
materialiseOscillatorNode
materialiseSamplePlayerNode
materialiseFilterNode
materialiseAdsrGainNode
materialiseGainNode
materialisePanNode
materialiseMixerNode
connectAudioOutputNode
```

When adding a node:

1. Resolve the descriptor id during `initialise(graph)`.
2. Throw a clear error if the graph does not contain that node.
3. Materialise the backend object from the runtime node role.
4. Keep device-specific behavior out of the executor.

For example, the executor should know how to materialise a filter node. It should
not know what Basic Synth is.

## 7. Add Validation And Runtime Tests

Add or update tests for:

- descriptor vocabulary
- typed port validation
- graph preset compilation
- execution order
- executor materialisation
- smoke wiring if the node participates in a device chain

Useful files:

- `packages/nodes/tests/descriptors.test.ts`
- `packages/audio-graph/tests/builder.test.ts`
- `packages/playback/tests/web-audio-executor.test.ts`

For port changes, make sure invalid direct connections still produce graph
diagnostics instead of runtime surprises.

## 8. Document Latency

If the node introduces fixed latency, set `latencySamples` on the descriptor.
The runtime graph can then report and eventually compensate latency across
executors.

Leave latency undefined or zero for nodes that do not add known fixed latency.

## 9. Verify

Run:

```bash
npm test -w packages/nodes
npm test -w packages/audio-graph
npm test -w packages/playback
npm run check --workspaces --if-present
npm test --workspaces --if-present
```

## Done

A node is complete when it has a descriptor, typed ports, graph coverage,
executor support for at least one backend when needed, and tests that prove the
graph compiler and executor agree on its role.
