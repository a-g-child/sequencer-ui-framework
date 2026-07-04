# Clock Architecture

Clocking is the timing layer between transport intent and runtime scheduling.

The long-term shape is:

```text
EditorTransportService
  -> user intent: play, stop, tempo, seek

ClockService
  -> timing source

PlaybackService
  -> schedules events from clock state

PlaybackOutput
  -> MIDI, audio, diagnostics, or other execution
```

## Boundary

The UI never owns clock timing.

UI components can ask for transport actions such as play, stop, tempo change, or
seek. They can observe clock status. They should not run timers, calculate
musical time, or call scheduler timing methods directly.

Transport is controller-facing intent. Clock is runtime time.

## ClockSource

`ClockSource` is the replaceable timing interface.

Every source must support:

- `start()`
- `stop()`
- `pause()`
- `resume()`
- `seek(beat)`
- `setBpm(bpm)`
- `getState()`
- `subscribe(listener)`

The active source emits clock events and exposes a `ClockState`.

## ClockState

`ClockState` is the scheduler-facing time snapshot.

It contains:

- running state
- beat
- bpm
- source time in milliseconds
- source id
- optional drift in milliseconds
- optional tick id

Schedulers consume this state. They should not depend on DOM timers,
`requestAnimationFrame`, `setInterval`, or `performance.now()` directly.

## Clock Events

Initial clock events:

- `clock:started`
- `clock:stopped`
- `clock:tick`
- `clock:seeked`
- `clock:tempo-changed`
- `clock:drift`

Events carry the current `ClockState`.

## InternalClockSource

`InternalClockSource` is the local TypeScript reference implementation.

It uses browser or JavaScript runtime time through `performance.now()` and an
interval-based tick loop initially. It supports BPM changes, seeking, start,
stop, pause, and resume.

It is not throwaway code. It is the reference behavior for future clock
implementations.

## ClockService

`ClockService` owns the active `ClockSource`.

It listens to transport intent events and forwards them to the active source.
It emits service events for clock lifecycle, ticks, seek, tempo changes, drift,
and status updates.

It also owns the source registry. The registry starts with the internal clock
and can later add:

- MIDI clock
- Ableton Link
- LTC or MTC
- native audio clock
- external robot timebase

## Scheduler Contract

The scheduler consumes `ClockState`.

Playback scheduling is triggered by clock ticks. The scheduler should use the
clock's beat and source time to decide which playback events fall inside the
look-ahead window.

The scheduler does not own clock timing. It does not own voices. It consumes a
`PlaybackModel`, advances from `ClockState`, and emits `PlaybackEvent` objects.

## Native Clock Contract

Future native or high-performance clocks must preserve the same interface.

Replacing the internal TypeScript clock with a native audio clock, external
timebase, or synchronization protocol should replace only the `ClockSource`
implementation.

It should not require replacing the transport service, playback service,
scheduler interface, playback model, outputs, or UI architecture.

