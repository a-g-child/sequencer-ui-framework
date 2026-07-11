# Runtime Event Model

Sequencer's native runtime is no longer only an audio graph executor.

It now has a second graph: the event graph.

The audio graph answers:

```text
Where do audio buffers flow?
```

The event graph answers:

```text
Where do musical intent and control messages flow?
```

Those are related, but they are not the same question.

## Core Principle

The scheduler must remain boring.

It owns time. It emits timestamped intent. It does not know which nodes are
voices, arpeggiators, recorders, instruments, effects, visualisers, or MIDI
outputs.

```text
Scheduler
  -> timestamped events
  -> execution plan
  -> event graph
  -> runtime nodes
```

The execution plan owns routing.

## Event Invariants

Runtime events follow these rules:

- Events are immutable once emitted.
- Events always carry absolute sample timestamps.
- Beat-domain events are converted to sample-domain events before dispatch.
- Events inside the committed scheduling horizon keep their sample position.
- Event processing is deterministic for a given plan, tempo snapshot, command
  stream, and sample position.
- Runtime nodes never discover one another dynamically.
- All event routing is resolved during plan preparation.
- Event routing is part of the execution plan, not a scheduler concern.

## Scheduler Responsibility

The scheduler may:

- hold tempo-map snapshots
- convert beats to absolute sample positions
- maintain a committed scheduling horizon
- store fixed-capacity scheduled events
- emit due events at exact offsets inside a callback block
- reschedule looped events deterministically

The scheduler must not:

- know what a voice is
- know which node should receive a note
- allocate voices
- inspect the audio graph
- rewrite runtime topology
- become a MIDI, clip, arpeggiator, or instrument engine

The scheduler creates events. The plan decides where they go.

## Event Graph Responsibility

The event graph is prepared from plan data.

```text
NativeExecutionPlan
  event routes
      source node
      destination node
      mask
      priority
      enabled

PreparedExecutionPlan
  prepared event graph
      resolved source ids
      resolved destination runtime indexes
      deterministic route order
```

The serialized plan may stay simple, but the prepared runtime should treat event
routes as a first-class graph. Audio routing and event routing evolve
independently.

## Runtime Node Roles

Runtime nodes may participate in one or both graphs.

Audio nodes consume and produce audio buffers:

```text
Oscillator
Gain
Output
Delay
Filter
```

Instrument nodes consume events and produce audio:

```text
Voice
Sampler voice
Drum voice
```

Event nodes consume, transform, duplicate, suppress, or emit events:

```text
Clip
Arpeggiator
Scale quantizer
Chord generator
Humaniser
MIDI filter
Recorder
MIDI output
Visualiser
```

These categories are behavioral roles, not inheritance requirements. A node can
process audio, process events, reset state, and participate in state transfer as
needed.

## Event Processing

The eventual runtime shape should be:

```text
trait EventProcessor {
    fn process_event(
        &mut self,
        event: ScheduledEngineEvent,
        output: &mut EventEmitter,
    );
}
```

The `EventEmitter` must be fixed-capacity and real-time safe. Event processors
may emit zero, one, or many events. This is what allows:

```text
Clip
  -> Arpeggiator
  -> Scale
  -> Chord
  -> Voice
```

without changing the scheduler or voice node.

Event processors must be bounded. The runtime should enforce a per-block event
budget or route-depth limit so cycles cannot spin forever inside the audio
callback.

## Audio Graph Relationship

The audio callback drives both graphs at sample time:

```text
Audio callback
  -> scheduler emits due sample-domain events
  -> event graph processes events
  -> event-driven nodes update musical state
  -> audio graph renders buffers
  -> output
```

Voice nodes are the bridge:

```text
event graph
  note on / note off
      -> voice state
          -> oscillator / envelope / gain
              -> audio buffer
                  -> audio graph
```

The event graph should not replace the audio graph. It feeds musical state into
nodes that the audio graph then renders.

## Determinism

Event processing order must be deterministic.

Routes should be resolved and sorted during plan preparation. A practical route
shape is:

```text
RuntimeEventRoute {
    source_node
    destination_node
    mask
    priority
    enabled
}
```

Fan-out is allowed:

```text
Keyboard
  -> Voice
  -> Recorder
  -> Visualiser
```

Priority defines deterministic ordering when multiple routes leave the same
source. Disabled routes remain in plan data but do not dispatch.

## Real-Time Rules

Event graph processing follows the same callback rules as audio processing:

- no heap allocation
- no locks
- no graph lookup by string id
- no document traversal
- no dynamic node discovery
- no unbounded recursion
- no unbounded event fan-out

All route resolution, validation, sorting, and buffer sizing happens off the
audio thread during plan preparation.

## Current Narrow Implementation

The current native runtime already contains the first form of this model:

```text
ScheduledEngineEvent
  -> prepared event routes
  -> runtime node event handler
  -> monophonic voice
  -> audio output
```

The scheduler does not know that the destination is a voice. It only emits an
event with a source/target id. The prepared execution plan resolves that id
through event routes.

## Non-Goals

This document does not define:

- polyphonic allocation
- voice stealing policy
- MIDI input mapping
- clip launch semantics
- arpeggiator behavior
- event recording
- event graph UI

Those are later runtime nodes and policies. They should build on this boundary
rather than expand the scheduler.
