# Native Runtime Status

Phase 9 has proven the native runtime boundary without committing the project
to a native implementation too early.

The important result is:

```text
Native can now enter below the runtime contracts.
The creative model does not need to change.
```

## Completed

### TypeScript Native Scheduler Seam

`NativeSchedulerAdapter` implements the same scheduler contract as
`TypeScriptScheduler`.

Current shape:

```text
PlaybackService
  -> Scheduler
  -> TypeScriptScheduler
  -> NativeSchedulerAdapter
```

The adapter currently wraps the TypeScript scheduler. Later it can wrap WASM,
IPC, N-API, or another native boundary without changing `PlaybackService`.

### DeviceCommand Bridge

Runtime voice decisions now have a native command shape.

```text
RuntimeDevice
  -> VoiceAction[]
  -> DeviceCommand[]
  -> NativeAudioAdapter
```

The WebAudio path remains intact:

```text
VoiceAction[]
  -> WebAudioOutput
```

That means native audio can become another execution backend without stealing
voice ownership from runtime devices.

### Panic Path

Safety-critical cleanup now flows through both execution worlds:

```text
transport stop / clip stop / disconnect / output off
  -> panic DeviceCommand
  -> NativeAudioAdapter
```

and:

```text
transport stop / clip stop / disconnect / output off
  -> OutputManager panic
  -> WebAudio cleanup
```

This proves the native command path for the command that matters most before
DSP exists.

### WASM Scheduler Stub

`@sequencer/native-scheduler-wasm` exists as a workspace package.

It currently provides:

- a Rust package scaffold
- a TypeScript WASM-shaped stub
- JSON functions for model, clock state, status, and event output
- a `WasmSchedulerAdapter` that implements the scheduler interface

Current behavior is intentionally minimal:

```text
NativePlaybackModel JSON
  -> WASM-shaped module

NativeClockState JSON
  -> WASM-shaped module
  -> NativePlaybackEvent[] JSON
```

The stub returns an empty event array. Its job is to prove the serializable
boundary and test harness.

### Tests

The current tests prove:

- `NativeSchedulerAdapter` matches `TypeScriptScheduler`
- `WasmSchedulerAdapter` can send model and clock state through JSON
- native scheduler JSON returns parseable `PlaybackEvent[]`
- `VoiceAction` converts to `DeviceCommand`
- panic commands are targetable and serializable
- `NativeAudioAdapter` acknowledges commands

## Pending

Rust implementation is pending a local Rust toolchain.

The current environment did not have:

- `rustc`
- `cargo`
- `rustup`

That is acceptable for the Phase 9 spike. The TypeScript seam is validated, and
the Rust package scaffold is present for the next environment that can compile
WASM.

## WASM Stub Replacement Checklist

Replace the stub internals in this order:

- Install Rust toolchain locally.
- Add `wasm32-unknown-unknown` or the chosen WASM target.
- Choose the binding strategy: `wasm-bindgen`, direct exported functions, or a
  generated JS wrapper.
- Make Rust accept `PlaybackModel` JSON and validate the required fields.
- Make Rust accept `ClockState` JSON and validate timing fields.
- Return `PlaybackEvent[]` JSON from Rust.
- Port the simplest non-looping note scheduling path.
- Add parity tests against `TypeScriptScheduler`.
- Add looped clip parity.
- Add automation sample parity.
- Add seek and stop parity.
- Add deterministic event id parity.
- Keep the TypeScript scheduler as the reference implementation until the WASM
  scheduler passes the shared suite.

## Native Work Resume Point

Phase 9 has done its job, but the next native step should not be another
replaceable prototype.

Native execution can now enter through known seams:

```text
Scheduler:
  PlaybackModel
  -> ClockState
  -> PlaybackEvent[]

Audio:
  VoiceAction
  -> DeviceCommand[]
  -> NativeAudioAdapter
```

The next best native investment is the real-time engine shell described in
`docs/real-time-native-runtime.md`:

- start an audio stream
- output silence
- own a monotonic sample counter
- drain a real-time-safe command queue
- publish telemetry for callback timing, xruns, queue depth, and sample position

That shell establishes the clock and callback discipline before oscillator,
sampler, or effect DSP is moved into native code.
