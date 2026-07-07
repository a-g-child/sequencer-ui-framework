# Native Runtime Integration

Sequencer should be able to adopt Rust, C++, or other purpose-built native
runtime code without turning the application into a rewrite.

The architectural rule is:

```text
Replace execution implementations.
Preserve creative contracts.
```

The document, operations, playback model builder, runtime device vocabulary,
automation model, parameter descriptors, and UI should remain TypeScript-facing
creative architecture. Native code should enter at runtime boundaries where
performance, timing, and low-level I/O matter.

## Why Native

TypeScript is a good place to describe intent, build models, drive UI, and
prove behavior.

Native code is useful when the project needs:

- lower jitter scheduling
- lower latency audio
- real-time safe DSP
- stable sample-accurate clocks
- hardware drivers
- MIDI timing outside the browser
- CPU-heavy synths, samplers, effects, or analysis

Native code should not become the place where creative truth lives.

## Stable Boundaries

The replaceable runtime boundaries are:

```text
Document
  -> Builder
  -> Runtime Model
  -> Execution
```

For playback:

```text
Document
  -> PlaybackModelBuilder
  -> PlaybackModel
  -> Scheduler
  -> PlaybackEvent[]
```

For devices:

```text
DeviceDescriptor
  -> DeviceInstance
  -> RuntimeDevice
  -> Execution Engine
```

For audio:

```text
RuntimeDevice
  -> VoiceAction / Parameter State / Device Commands
  -> Audio Engine
  -> Driver
```

Native work should attach below these contracts. It should not bypass them.

## Native Scheduler

The current TypeScript scheduler is the reference implementation. A native
scheduler should implement the same conceptual contract:

```text
setModel(PlaybackModel)
start(beat)
stop()
seek(beat)
tick(clockState) -> PlaybackEvent[]
scheduleLookahead(window) -> PlaybackEvent[]
status()
```

The scheduler must remain a scheduler only.

It may:

- maintain a high-resolution clock
- expand looped notes and automation samples
- emit deterministic playback event batches
- report queue depth, lookahead depth, and timing diagnostics
- improve jitter and event timing

It must not:

- read or mutate the document
- allocate synth voices
- build audio graphs
- know oscillator, sampler, filter, or hardware-module internals
- own UI state
- become the source of saved project truth

The native scheduler consumes `PlaybackModel` and emits `PlaybackEvent`
objects. Everything around it should continue to talk through the scheduler
interface.

### Scheduler Data Shape

The first native scheduler bridge should use plain serializable data:

```text
PlaybackModel
  tracks
  clips
  notes
  automations
  tempoMap

ClockState
  timeMs
  beat
  bpm
  playing

PlaybackEvent
  id
  type
  timeMs
  beat
  trackId
  destination
  payload
```

Avoid passing document objects, class instances, Svelte state, or mutable
registries across the native boundary.

### Scheduler Bridge Options

Browser builds can start with WebAssembly:

```text
TypeScript PlaybackService
  -> WasmSchedulerAdapter
  -> Rust/C++ scheduler core
```

Desktop or embedded builds can later use a process-local native bridge:

```text
TypeScript PlaybackService
  -> NativeSchedulerAdapter
  -> N-API / C ABI / IPC
  -> Rust/C++ scheduler core
```

The adapter should translate between the TypeScript scheduler interface and the
native implementation. The rest of playback should not know which scheduler is
active.

### Scheduler Acceptance Tests

A native scheduler should share reference behavior tests with the TypeScript
scheduler:

- same note events for the same playback model
- same automation samples at the same beat positions
- deterministic event ids
- no duplicate events after lookahead scheduling
- seek clears queued state correctly
- stop clears emitted state correctly
- looped clips emit the expected repeated events

The TypeScript scheduler remains the readable specification. Native
implementations must match it before optimizing beyond it.

## Native Audio And Device Execution

The Golden Device has established the execution path:

```text
PlaybackEvent
  -> PlaybackDeviceManager
  -> RuntimeDevice
  -> VoiceManager / RuntimeParameter
  -> VoiceAction
  -> Output / Audio Engine
```

A native audio engine should fit behind that path.

The runtime device owns musical interpretation:

- which voices exist
- which note steals which voice
- which parameters are current, target, smoothed, or modulated
- which voice actions should occur
- which device commands are emitted

The native engine owns execution:

- oscillator, sampler, and effect DSP
- audio buffers
- sample rate conversion
- audio thread scheduling
- driver integration
- real-time safe command queues
- metering and latency reporting

This keeps a future Rust synth, C++ sampler, WebAudio executor, and hardware
module as peers behind the same RuntimeDevice architecture.

## Audio Bridge Shape

The first native audio bridge should be command based.

```text
TypeScript RuntimeDevice
  -> DeviceCommand[]
  -> NativeAudioAdapter
  -> Native audio engine
```

Initial commands can mirror current voice actions:

```text
voice:start
voice:release
voice:steal
parameter:set
parameter:ramp
transport:start
transport:stop
panic
```

The bridge should prefer numeric ids, compact strings, or interned symbols over
large object graphs. It should send snapshots or commands, not live objects.

The native audio thread must not wait on TypeScript. Use a lock-free queue,
ring buffer, or double-buffered command block in runtimes where that matters.

## Runtime Parameters Across Native

Device parameters are the shared language between UI, automation, runtime
devices, and execution.

The TypeScript side owns descriptor meaning:

```text
DeviceParameterDescriptor
  key
  name
  kind
  defaultValue
  min / max / step / unit / scale
```

The runtime owns value evolution:

```text
RuntimeParameter
  value
  targetValue
  smoothedValue
  modulationValue
  effectiveValue
```

A native engine should receive the effective value or an explicit parameter
command. It should not need to know whether a value came from a saved device
instance, clip automation, an LFO, a hardware encoder, or a UI drag.

That preserves the path:

```text
Descriptor
  -> Inspector
  -> Automation
  -> RuntimeParameter
  -> Native DSP
```

## Device Factories

Native implementations should appear as device factories.

```text
DeviceDescriptor
  -> DeviceFactory
  -> RuntimeDevice
  -> Native handle
```

Examples:

```text
Basic Synth Descriptor
  -> WebAudioBasicSynthFactory
  -> BasicSynthRuntimeDevice
  -> WebAudioOutput

Basic Synth Descriptor
  -> NativeBasicSynthFactory
  -> BasicSynthRuntimeDevice
  -> NativeAudioEngine
```

The descriptor and document instance can stay the same while the factory
changes. That is the test of whether execution is truly replaceable.

## Missing And Unavailable Native Backends

Projects must remain openable when native backends are missing.

If a native module, dynamic library, hardware driver, or attached DSP module is
unavailable, the runtime should create a missing runtime device or fall back to
a compatible implementation when possible.

The document should retain:

- device assignment
- parameter values
- automation
- routing intent

Unavailable execution is a runtime condition, not a document deletion.

## Suggested Milestones

### 1. Native Scheduler Adapter

Keep the TypeScript scheduler as reference. Add an adapter with the same public
contract and prove equivalence with shared tests.

### 2. Native Event Clock

Move timing-sensitive scheduling into Rust or C++ while keeping event emission
in the same `PlaybackEvent` shape.

### 3. Native Audio Command Bridge

Introduce a command queue from runtime devices to a native audio engine. Start
with `voice:start`, `voice:release`, `parameter:set`, and `panic`.

### 4. Native Basic Synth Executor

Keep `BasicSynthRuntimeDevice` and its descriptors in TypeScript. Replace only
the sound executor with a native oscillator/envelope/filter implementation.

### 5. Native Device Factories

Allow the device registry to choose between WebAudio, native, external MIDI,
hardware-module, or missing factories for the same descriptor.

## Non-Goals

Do not move these into native code first:

- document mutation
- undo and redo
- serialization
- inspector UI
- automation authoring
- descriptor definitions
- project validation
- editor sessions

Those are creative and application concerns. Native runtimes should make
execution better without stealing ownership of intent.

## Guiding Test

The guiding question is:

```text
Can the same project open with a TypeScript/WebAudio runtime and a native
runtime without changing the document?
```

If yes, the boundary is probably right.

If no, native execution has leaked into creative intent and the contract needs
to be tightened.
