# How To Build A Device

This guide is for adding a Sequencer device that participates in the current
execution architecture:

```text
DeviceDescriptor
  -> graph preset
  -> RuntimeDevice
  -> RuntimeAudioGraph diagnostics
  -> executor-backed playback
```

Devices should describe musical intent and coordinate runtime state. Signal
processing should live in graph nodes and executor implementations.

## 1. Create A Device Descriptor

Add a descriptor under `packages/device/src/descriptors`.

Use existing devices as references:

- `packages/device/src/descriptors/basic-synth.ts`
- `packages/device/src/descriptors/sampler.ts`

A descriptor should define:

- stable `id` and `key`
- display `name`
- `capabilities`
- `graphPreset`
- device ports
- runtime parameters

Keep parameter ids stable. They are used by runtime parameter state, automation,
tests, and UI inspection.

## 2. Define Runtime Parameters

Device parameters are declared on the descriptor and materialised with
`createRuntimeParameters`.

Use runtime parameters for values that belong to the device coordinator:

- oscillator waveform selection
- device volume
- envelope settings
- sampler mode
- glide settings
- high-level modulation choices

Do not duplicate backend-specific values here unless the device genuinely owns
them. A node parameter should stay with the graph node when it is part of the
signal-flow vocabulary.

## 3. Create An Execution Graph Preset

Add a graph preset under `packages/audio-graph/src/presets`.

The preset is the execution description for the device. It should contain:

- graph `id`
- metadata
- nodes
- typed connections
- node parameter defaults

Current reference chains:

```text
Basic Synth
oscillator -> filter -> ADSR gain -> track gain -> pan -> mixer -> output

Sampler
sample-player -> ADSR gain -> track gain -> pan -> mixer -> output
```

The graph builder validates typed ports. Invalid direct connections such as
MIDI to audio or audio to control should fail before execution.

Export the preset from `packages/audio-graph/src/presets/index.ts` if it should
be public.

## 4. Build A Runtime Device

Add a factory under `packages/device/src/factories`.

The runtime device should extend `BaseRuntimeDevice` and receive:

- the device instance
- runtime parameters
- the compiled runtime graph

The factory should build the graph with:

```ts
new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS).build(MY_GRAPH_PRESET)
```

The runtime device should coordinate intent-level behavior:

- voice allocation
- note and parameter event interpretation
- slot/sample resolution
- pending voice or sample actions
- diagnostics
- panic/reset behavior

It should not create WebAudio nodes or run DSP.

## 5. Support Live UI-Controlled Parameters

If a user-facing UI control changes device parameters while playback is running,
the runtime device must expose those changes through runtime parameters.

The current live-control path is:

```text
UI control
  -> SetDeviceParameterValueOperation
  -> RuntimeDeviceRegistry.setRuntimeParameterValue
  -> RuntimeDevice.advance(...)
  -> playback/output sync
  -> executor node update
```

For descriptor parameters:

- string, boolean, and choice values update immediately
- number values are smoothed by runtime parameters
- smoothed number values only become effective after `advanceRuntimeParameters`

That means any runtime device with live numeric controls should implement:

```ts
advance(deltaMs: number): void {
  advanceRuntimeParameters(this.parameters, deltaMs);
}
```

Without this, UI dials can update the document and target value while playback
continues reading the old effective value.

Playback must also sync the runtime values into the execution backend. For
WebAudio-backed devices, add a focused sync path in playback service/output
code that:

- finds the runtime device on the selected track/device chain
- reads values with `getRuntimeParameterEffectiveValue`
- normalizes and clamps values before they reach WebAudio
- calls an output/executor update method for the live node chain

If a parameter has both free and tempo-synced modes, keep both values explicit
in the descriptor. For example, a delay can expose:

- `time`
- `timeMode`
- `syncDivision`
- `feedback`
- `mix`

The backend sync layer can then derive seconds from BPM only when `timeMode` is
`sync`, while the document still preserves the free-time value.

Add a regression test for live numeric controls. The test should set a runtime
parameter value, assert the effective value has not changed before advance, call
`device.advance(...)`, and assert the effective value has updated.

## 6. Register The Device

Register the descriptor and factory where device creation is assembled.

Use the current factory and registry modules as the source of truth:

- `packages/device/src/factory.ts`
- `packages/device/src/registry.ts`
- `packages/core/src/factory.ts`

After registration, a document/device instance should be able to refer to the
descriptor key and create the runtime device.

## 7. Bind Execution To Nodes

If the device uses existing nodes, it can often reuse existing executor support.

If it requires a new node, add the node first. The playback executor should
materialise graph node roles, not device names. Prefer executor methods shaped
like:

```text
materialiseOscillatorNode
materialiseSamplePlayerNode
materialiseAdsrGainNode
materialiseGainNode
materialisePanNode
materialiseMixerNode
connectAudioOutputNode
```

Avoid methods such as `createBasicSynthThing` or `runSamplerThing`. The executor
should know nodes, not instruments.

## 8. Add Tests

At minimum, add tests that prove:

- the descriptor exposes the graph preset
- the runtime graph builds without diagnostics
- the runtime graph node and connection counts are expected
- execution order is stable
- runtime parameters still work
- the runtime device emits the same musical actions as before
- diagnostics expose graph information
- live numeric UI controls advance runtime effective values

Useful references:

- `packages/device/tests/basic-synth-graph.test.ts`
- `packages/device/tests/sampler-graph.test.ts`
- `packages/device/tests/sampler-runtime.test.ts`
- `packages/playback/tests/web-audio-executor.test.ts`

If playback execution changes, add a smoke test that materialises the relevant
graph chain through `WebAudioExecutor`.

## 9. Verify Diagnostics

Runtime diagnostics should include graph visibility:

- preset id
- node count
- connection count
- execution order
- latency summary
- validation diagnostics
- node diagnostics

This makes the graph layer inspectable before deeper profiling and native
execution fill in timing metrics.

## 10. Run Verification

Run:

```bash
npm run check --workspaces --if-present
npm test --workspaces --if-present
```

For focused development, run the package tests first:

```bash
npm test -w packages/audio-graph
npm test -w packages/device
npm test -w packages/playback
```

## Done

A device is complete when documents can select it, the runtime can compile its
graph preset, diagnostics are visible, and playback execution uses graph nodes
instead of device-specific DSP code.
