# Real-Time Native Runtime

This is the point where Sequencer moves from replaceable execution prototypes to
a deliberate real-time runtime.

The native audio callback should become the authoritative clock for audio
playback. The scheduler remains a conceptual subsystem, but its real-time
implementation belongs beside the graph executor inside the native engine. The
TypeScript and WASM schedulers remain the readable reference implementation,
offline-test implementation, and browser fallback.

## Final Architecture

```text
Svelte / TypeScript application
  Document + operations
  PlaybackModelBuilder
  ExecutionGraph presets/compiler
  Device descriptors and instances
  UI sessions and view models

          commands / snapshots
                   ↓

Native engine control thread
  Playback-model snapshot manager
  Graph compiler / backend lowering
  Asset decoding and preparation
  Device/runtime coordination
  MIDI and hardware configuration

          lock-free queues
                   ↓

Real-time audio thread
  Master sample clock
  Sample-accurate scheduler
  Fixed voice pools
  Compiled execution plans
  DSP graph processing
  Parameter ramps/modulation
  Mixer and output
```

Telemetry flows in the reverse direction:

```text
Audio thread
  -> telemetry queue
  -> control thread
  -> UI status
```

Telemetry includes meters, voice counts, xruns, callback load, playhead,
command queue depth, late events, queue overflows, and node timings.

The UI must never be in the critical timing path.

## Scheduler Timebase

The native scheduler consumes the same logical playback intent as the
TypeScript scheduler, but changes the physical timebase:

```text
beat-domain event
  -> tempo/swing interpretation
  -> absolute sample position
  -> sample offset within audio block
  -> node receives event at exact sample offset
```

Native scheduling should use:

- `u64 samplePosition`
- `u32 sampleOffsetWithinBlock`

Scheduling operates in two horizons:

- Planning horizon: upcoming bars/beats can be reinterpreted.
- Committed horizon: events close to playback are converted to sample
  positions and remain stable.

This protects live BPM and swing changes from creating duplicate notes, missing
notes, or timing discontinuities.

## Real-Time Control Behaviour

Ordinary parameter movement must not rebuild a graph or runtime device.

```text
UI drag
  -> parameter command
  -> command queue
  -> short sample ramp
  -> DSP reads effective value
```

Supported command families:

- `parameter:set`
- `parameter:ramp`
- `parameter:modulate`

BPM changes update an immutable tempo-map snapshot. The scheduler swaps to that
snapshot at a defined boundary and converts future beat events using the new
map. Live groovebox modes can later distinguish immediate tempo changes from
beat/bar-quantized tempo changes.

Swing remains a beat-domain transformation:

```text
nominalBeat -> swing warp -> effectiveBeat -> sample position
```

Only events outside the committed scheduling horizon should be recalculated.

## Graph Edits

Never mutate the executing graph in place.

```text
UI edits graph
  -> compile new RuntimeGraph
  -> lower to new NativeExecutionPlan off-thread
  -> prepare buffers and state
  -> atomic swap at block boundary
```

Where node ids and types match, transfer state:

- delay buffers
- filter state
- envelope phase
- sample position
- LFO phase

Where state cannot be transferred, use a short crossfade between old and new
plans.

## Audio Callback Rules

The callback must not perform:

- heap allocation or deallocation
- mutex locking
- file or network access
- JSON parsing
- console logging
- asset decoding
- graph compilation
- document traversal
- waiting on TypeScript

Use fixed-capacity pools for:

- voices
- scheduled events
- MIDI events
- parameter commands
- audio buffers
- node state

Control-to-audio communication should use fixed-size binary commands, numeric
ids, ring buffers, and double-buffered command blocks. JSON remains acceptable
for early WASM adapters and test fixtures, but not between the native control
thread and audio callback.

## Backend Planning Stage

The generic graph compiler remains backend-neutral:

```text
ExecutionGraph
  -> validate
  -> resolve
  -> optimise
  -> schedule
  -> RuntimeGraph
```

Native adds one backend-specific lowering stage:

```text
RuntimeGraph
  -> NativeExecutionPlanner
  -> NativeExecutionPlan
```

The native plan can contain:

- flat node arrays
- preallocated buffer indices
- event routes
- parameter indices
- voice templates
- audio-rate and control-rate execution groups
- latency compensation data
- cache-friendly node state layouts

The real-time executor then drains commands, dispatches scheduled events for
the current block, processes nodes in order, mixes outputs, and publishes
telemetry.

## Polyphonic Instruments

Polyphonic instruments use two graph levels:

```text
Voice graph template
  oscillator/sample-player
  -> filter
  -> envelope/VCA

Track graph
  voice mixer
  -> track FX
  -> volume/pan
  -> output
```

The engine creates a fixed voice pool from the voice graph template. It must not
dynamically create graph objects on each note-on.

## Migration Order

1. Native engine shell: start an audio stream, output silence, maintain a
   monotonic sample counter, report sample rate, block size, callback timing,
   and xruns.
2. Command and telemetry queues: fixed-size SPSC command and telemetry rings
   for `transport:start`, `transport:stop`, `panic`, and `parameter:set`.
3. Audio-clock scheduler: move native transport onto the sample counter,
   convert beat events to sample offsets, and match TypeScript scheduler parity.
4. One native signal chain: compile and execute oscillator to ADSR gain to
   output, then add filter, track gain, pan, and mixer.
5. Sampler: decode assets off-thread, transfer immutable buffers, use fixed
   voice pools, and never decode or resize in the callback.
6. Live parameter path: sample-offset parameter commands, ramps, automation,
   LFO modulation, and BPM/swing changes under load.
7. MIDI: timestamped MIDI input/output entering the same sample-domain
   scheduler.
8. Backend parity: run the same projects against WebAudio, WASM/AudioWorklet,
   and native executors.

## Acceptance Criteria

- no audible discontinuity during normal volume/filter/FX movement
- BPM and swing changes without stuck or duplicated notes
- quantized clip launches remain aligned across tracks
- no allocation or locks in the callback
- panic always clears all active voices
- graph swaps occur without crashes or long dropouts
- deterministic scheduler parity with the TypeScript reference
- visible xrun, callback-load, queue-overflow, and late-event diagnostics
- the same document opens unchanged with WebAudio and native execution

The strongest next implementation is a native engine shell that outputs
silence, owns a sample clock, drains a real-time-safe command queue, and reports
reliable telemetry.
