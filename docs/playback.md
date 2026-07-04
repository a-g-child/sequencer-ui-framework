# Playback Architecture

Playback is the runtime interpretation layer between the editable document and
event outputs such as MIDI, audio engines, or diagnostics.

The core pipeline is:

```text
Document
  -> PlaybackModelBuilder
  -> PlaybackModel
  -> Scheduler
  -> PlaybackOutput
```

## Boundary

Playback code is not UI code.

The playback package must not import Svelte, DOM APIs, canvas code, editor
sessions, renderer registries, or render models. It consumes document and music
domain data, then produces playback-domain snapshots and events.

Render models answer the question: "How should this be shown?"

Playback models answer the question: "What should happen over time?"

Those are separate concerns. Playback never consumes `RenderModel` objects.

## PlaybackModelBuilder

`PlaybackModelBuilder` translates the mutable document state into an immutable
playback snapshot.

It is responsible for:

- reading tracks, patterns, placements, notes, and tempo information
- expanding pattern placements
- expanding `loopCount`
- applying performance interpretation such as `getEffectiveBeat()`
- applying effective note velocity such as `getEffectiveVelocity()`
- producing sorted playback notes and clips

The builder is the document adapter. The scheduler should not read or interpret
the document directly.

## PlaybackModel

`PlaybackModel` is the scheduler input.

It contains playback-native data only:

- tracks
- expanded clips
- expanded notes
- tempo map
- timeline length

The model is intentionally immutable. A document edit creates a new playback
snapshot rather than mutating scheduler-owned document state.

## Scheduler

The scheduler consumes only `PlaybackModel`.

It is responsible for:

- accepting a playback model with `setModel(model)`
- starting at a beat position
- stopping
- seeking
- advancing time with `tick(now)`
- scheduling a look-ahead window
- emitting `PlaybackEvent` objects once

The scheduler does not own voices. Voice allocation, synthesis, MIDI routing,
audio graph behavior, and device I/O belong behind outputs or later runtime
layers.

The TypeScript scheduler is the reference implementation. It is not throwaway
prototype code.

Future Rust or C++ schedulers must preserve the same architectural contract:

```text
Scheduler consumes PlaybackModel
Scheduler emits PlaybackEvents
PlaybackService talks through the Scheduler interface
UI talks to PlaybackService, not to scheduler internals
```

When a native scheduler arrives, it should replace only the scheduler
implementation. It should not require replacing the document model,
`PlaybackModelBuilder`, `PlaybackModel`, UI panels, transport service, or output
architecture.

## PlaybackOutput

Outputs consume `PlaybackEvent` objects.

The first output is `ConsoleMidiOutput`, which logs MIDI-style note events. More
outputs can be added for Web MIDI, audio engines, native device bridges, tests,
recording, or diagnostics.

Outputs should not read the document. They should not read render models. They
receive scheduled event objects and decide how to handle them.

## Events

Playback events are MIDI-style runtime objects.

Initial event types:

- `NoteOn`
- `NoteOff`

Planned event types:

- `TempoChange`
- `TransportEvent`

Note events include:

- pitch
- velocity
- channel or track
- beat
- scheduled time in milliseconds

This event stream is the boundary between scheduling and output behavior.

## Service Integration

`PlaybackService` owns the active scheduler and current playback model.

It listens to:

- document operations
- undo and redo
- transport play and stop
- tempo changes

On document edits, it rebuilds the playback model and passes the new immutable
snapshot to the scheduler. On transport changes, it starts, stops, or updates
the scheduler through the scheduler interface.

UI code should talk only to `PlaybackService` and read service status. It should
not call scheduler methods directly.

