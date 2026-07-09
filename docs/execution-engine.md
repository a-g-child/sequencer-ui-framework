# Execution Engine

Sequencer's execution layer should preserve the separation that has emerged
across playback, devices, and audio graphs:

```text
Descriptor
  -> Graph Preset
  -> AudioGraphBuilder / ExecutionGraphBuilder
  -> RuntimeGraph
  -> Execution Backend
  -> Driver
```

This is the Phase 10 contract. The document remains creative intent. Graphs
describe execution. Backends execute resolved graphs.

The graph layer should be understood as an execution graph, not only an audio
graph. Audio, MIDI, control, and hardware signals all use the same underlying
idea: typed ports connected through reusable nodes.

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

## Node Vocabulary

A shared package should hold node definitions without tying them to a backend:

```text
packages/nodes
  audio/
  midi/
  control/
  hardware/
```

Concrete node families include:

```text
Audio
  oscillator/
  sample-player/
  adsr/
  gain/
  filter/
  mixer/
  delay/
  compressor/
  output/

MIDI
  midi-input/
  midi-filter/
  midi-channel/
  midi-transpose/
  midi-split/
  midi-merge/

Control
  automation/
  lfo/
  envelope/
  macro/
  math/
  random/
  sequencer/

Hardware
  cv-output/
  gate-output/
  gpio/
  serial/
  network/
  lighting/
```

This package should not be WebAudio, Rust, C++, or hardware specific. It should
define node identities, ports, parameters, metadata, and validation rules. The
same node vocabulary can then feed WebAudio, native audio, DSP modules, or
hardware modules.

Nodes themselves become reusable components. A synth is a graph of nodes, not a
bespoke monolith:

```text
MIDI Input
  -> Oscillator
  -> Filter
  -> Envelope / Gain
  -> Output
```

A sampler is the same pattern with a different source:

```text
MIDI Input
  -> Sample Player
  -> Envelope / Gain
  -> Output
```

The backend should not need to know what a synth is. It should know how to run
oscillator, sample-player, filter, gain, delay, mixer, and hardware I/O nodes.

## Typed Ports

Ports are the validation contract. Every node advertises typed inputs and
outputs:

- audio
- stereo audio
- MIDI
- gate
- trigger
- control
- boolean
- CV
- GPIO
- serial
- network
- lighting

The graph builder validates port compatibility before execution. A MIDI output
connected to an audio input should fail as a type mismatch. A control signal can
modulate cutoff because both sides agree on a control-compatible port.

## Graph Compiler

`AudioGraphBuilder` is becoming a graph compiler. The graph document is source
material; the runtime graph is the executable model that backends consume.

The compiler pipeline should remain explicit:

```text
validate()
  -> resolve()
  -> optimise()
  -> schedule()
  -> RuntimeGraph
```

Current responsibilities:

- validate node and connection shape
- resolve node descriptors
- resolve typed ports
- resolve parameter defaults and overrides
- reject invalid direct connections
- produce execution order
- assign runtime execution indices
- report latency and diagnostics

Runtime nodes should carry profiling-friendly identity:

- `id`: the graph node id from the authored graph
- `descriptorId`: the resolved node descriptor id
- `resolvedPorts`: resolved input and output ports
- `executionIndex`: the node's scheduled runtime position

This lets backends and diagnostics report useful runtime information without
losing the authored graph identity:

```text
Node 17
Oscillator
Execution time
CPU %
Latency
```

Reserved optimisation responsibilities:

- dead node elimination
- constant folding
- adjacent gain/pan collapse
- latency propagation
- SIMD grouping hints
- vectorisation hints
- hardware or FPGA partitioning hints

The optimisation phase can be a no-op until the execution backends need it. The
important part is reserving the compiler stage before backend-specific execution
logic starts to accrete.

## Converter Nodes

Typed ports should reject invalid direct connections. Conversions should be
explicit nodes:

```text
MIDI
  -> MIDI Note To Frequency
  -> Control
```

```text
Audio
  -> Audio Envelope To Control
  -> Control
```

```text
Control
  -> Control To CV
  -> Hardware
```

Examples of converter nodes:

- MIDI to control
- audio to control
- control to trigger
- control to CV
- mono to stereo
- stereo to mono

This keeps validation strict while making intentional conversions visible in the
runtime graph.

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
