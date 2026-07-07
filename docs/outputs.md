# Output Architecture

Playback emits deterministic `PlaybackEvent` objects. Output systems execute
them.

```text
Document
  -> PlaybackModelBuilder
  -> PlaybackModel
  -> Scheduler
  -> PlaybackEvents
  -> OutputManager
       -> PlaybackOutput
       -> PlaybackOutput
       -> PlaybackOutput
```

There is no direct line from the scheduler to MIDI, audio, OSC, robotics, or
any other execution system.

## Roles

Documents compose.

Playback models interpret.

Schedulers schedule.

Outputs execute.

Render models visualise.

Keeping those verbs separate keeps playback extensible without making the
scheduler responsible for every possible runtime destination.

## PlaybackOutput

`PlaybackOutput` is the execution boundary.

```ts
interface PlaybackOutput {
  readonly id: string
  readonly name: string

  connect(): Promise<void>
  disconnect(): Promise<void>
  handleEvents(events: PlaybackEvent[]): void
}
```

Outputs receive event batches. They do not expose special methods such as
`playNote()`. They should not read the document, scheduler internals, render
models, or editor state.

Outputs understand events.

## OutputManager

`OutputManager` owns registered outputs, tracks active outputs, receives
scheduled playback events, and routes each batch to active outputs.

```text
Scheduler
  -> PlaybackEvents
  -> OutputManager
  -> routed PlaybackOutput
```

The scheduler does not know which outputs exist.

Early diagnostic outputs can still observe every event. Creative outputs should
receive events through routing so internal synths, samplers, MIDI ports,
hardware modules, robotics targets, and lighting targets do not compete for the
same undifferentiated event stream.

## OutputRegistry

`OutputRegistry` mirrors the renderer pattern:

- `register(output)`
- `remove(outputId)`
- `outputs()`

Initial outputs include:

- `ConsoleOutput`
- `MidiOutputStub`
- `EventLoggerOutput`
- `StatisticsOutput`
- `MockOutput`

## Reference Outputs

`ConsoleOutput` is a debugging output. It logs playback events and is not a MIDI
device.

`MidiOutputStub` translates note events into MIDI-style messages through a small
port interface. It is a stub, not a device implementation.

`EventLoggerOutput` collects playback events as JSONL. Its default filename is
`timeline.jsonl`, and it is intended for deterministic testing and diagnosis.

`StatisticsOutput` observes event flow and records basic runtime statistics.

`MockOutput` stores received events for tests.

None of these outputs own playback.

## Capabilities

Outputs can advertise capabilities:

```ts
interface OutputCapabilities {
  noteEvents: boolean
  controlEvents: boolean
  automation: boolean
  clock: boolean
  transport: boolean
}
```

This lets future routing and validation understand that different destinations
support different event families.

## Routing

Routing should remain outside the scheduler.

Future track output assignment might look like:

```text
Track 1 -> Basic Synth -> Web Audio
Track 2 -> Sampler -> Web Audio
Track 3 -> External MIDI Device -> Web MIDI
Track 4 -> Robot Arm -> Network Output
```

The scheduler still emits playback events. Routing decides which output receives
which events.

The destination carried by a playback event should be enough for
`OutputManager` to route it:

```text
PlaybackEvent.destination
  trackId
  deviceId
  outputId?
  channel?
```

If no explicit output route exists, the manager can fall back to a default
creative output such as `WebAudioOutput` or a diagnostic output such as
`ConsoleOutput`.

## Future Audio

Audio output should be a `PlaybackOutput`.

```text
PlaybackEvents
  -> AudioOutput
  -> VoiceManager
  -> DSP
  -> Driver
```

The voice manager belongs inside the audio output. It does not belong in the
scheduler.

## Future OutputGraph

The first shape is direct fan-out:

```text
Scheduler -> OutputManager -> Outputs
```

A later `OutputGraph` can add filters and mappers:

```text
Scheduler
  -> OutputGraph
  -> Filter
  -> Mapper
  -> Outputs
```

Examples:

- transpose
- velocity curve
- channel mapper
- clock divider
- robot coordinate mapper

This follows the same philosophy as renderers: add interpretation layers without
breaking the document or scheduler contracts.

## Native Boundary

Today the outputs are TypeScript.

Later, an output can be backed by Rust, C++, a native driver, a network bridge,
or a hardware-specific runtime.

The interface remains the same:

```text
class MyOutput implements PlaybackOutput
```

Register it with the output registry, connect it through the output manager, and
the scheduler remains untouched.
