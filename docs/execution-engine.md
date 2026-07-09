# Execution Engine

Sequencer's execution layer should preserve the separation that has emerged
across playback, devices, and audio graphs:

```text
Descriptor
  -> Graph Preset
  -> AudioGraphBuilder
  -> RuntimeGraph
  -> Execution Backend
  -> Driver
```

This is the Phase 10 contract. The document remains creative intent. Graphs
describe execution. Backends execute resolved graphs.

## Core Principle

```text
Graphs describe execution, not intent.
```

A saved project should not need to store hundreds of oscillator, filter, gain,
and routing nodes just to say that a track uses Basic Synth. It should store the
creative choice:

```text
Track -> Basic Synth device instance
```

The device descriptor derives the graph preset, and the runtime derives the
resolved graph. This mirrors the playback architecture:

```text
Document
  -> PlaybackModelBuilder
  -> PlaybackModel
```

For devices:

```text
Descriptor
  -> AudioGraphBuilder
  -> RuntimeGraph
```

That keeps saved documents compact, durable, and independent from implementation
details that can evolve over time.

## RuntimeDevice As Graph Host

`RuntimeDevice` should increasingly act as a graph host, not the thing that
directly makes sound.

Its responsibilities are:

- graph selection
- parameter binding
- voice allocation
- automation interpretation
- modulation state
- runtime diagnostics
- command emission for execution backends

The graph's responsibility is signal-flow description:

- nodes
- ports
- connections
- execution order
- latency hints
- validation diagnostics

The backend's responsibility is execution:

- WebAudio nodes
- native DSP
- audio buffers
- scheduling queues
- driver I/O
- hardware integration

## Device Graphs And Project Graphs

There are two different graph families and they should remain separate.

Device graphs describe per-device signal flow:

```text
MIDI
  -> Oscillator / Sample Player
  -> Filter
  -> Gain / Envelope
  -> Output
```

Project graphs describe project-level routing:

```text
Track
  -> Device
  -> Mixer
  -> Master
  -> Driver
```

Device graphs are implementation details of devices. Project graphs are routing
and mixing structure for the song/session. They can share concepts, but they
should not collapse into one model too early.

## Audio Node Vocabulary

A future package can hold shared node definitions without tying them to a
backend:

```text
packages/audio-nodes
  oscillator/
  sample-player/
  adsr/
  gain/
  filter/
  mixer/
  delay/
  compressor/
  output/
```

This package should not be WebAudio, Rust, C++, or hardware specific. It should
define node identities, ports, parameters, metadata, and validation rules. The
same node vocabulary can then feed WebAudio, native audio, DSP modules, or
hardware modules.

## Migration Strategy

The migration path should remain conservative:

```text
Descriptor
  -> Graph Preset
  -> RuntimeGraph diagnostics
  -> Existing RuntimeDevice behavior
```

Then later:

```text
Descriptor
  -> Graph Preset
  -> RuntimeGraph
  -> Native Engine
```

This lets Sequencer prove the graph vocabulary, builder, diagnostics, and
execution contract without breaking the working synth, sampler, scheduler, or
WebAudio bridge.

## Custom Graph Editing

Do not let users edit runtime graphs yet.

Version 1 should prove:

- the node vocabulary
- the graph builder
- runtime graph diagnostics
- WebAudio reference execution
- native execution

Custom graph devices and a visual graph editor can come later, after the
execution contract is stable. Until then, the user-facing model should remain:

```text
Descriptor
  -> Graph Preset
  -> RuntimeGraph
```

## Layer Map

Sequencer's long-term architecture can be thought of in four layers:

```text
Musical Layer
  Synth
  Sampler
  Drum Machine
  MIDI Device
  Audio Input

Graph Layer
  AudioGraph
  ControlGraph
  ProjectGraph

Execution Layer
  WebAudio
  Native Audio
  DSP Module
  Hardware Module

UI Layer
  Matrix
  Editors
  Inspector
  Graph View
  Mixer
```

Each layer should have a natural home and a clear boundary. The document stores
creative intent. Builders derive runtime models. Backends execute.
