# Sequencer Architecture

Sequencer is a creative document framework for time-based systems. Music is the first domain, but the core model should remain general enough for automation, routing, UI state, lighting, motion, and other timeline-driven documents.

## Core Principles

The document is state. It can be saved, diffed, serialized, transmitted, validated, and tested without UI, audio, or runtime services attached.

Musical intent is persistent. Performance is interpretive. Playback is derived.
The document always preserves the author's intent. Everything else is layered
on top.

The UI never mutates the document directly. User actions go through commands, commands mutate the document, history records those mutations, and observers react to the result.

Core knows about entities, relationships, registries, timelines, properties/parameters, validation, and document editing. Core should not know about DSP, MIDI devices, Svelte components, audio engines, or visual presentation.

Prefer general concepts over musical concepts in core. If a type is equally useful for tracks, fixtures, cameras, macro controls, automation, or UI state, it belongs in core. If it is specifically about synthesis, sampling, MIDI, or audio processing, it belongs above core.

## Document Model

The canonical state object is `SequencerDocument`.

Today it contains:

- `timeline`
- `tracks`
- `patterns`
- `parameters`
- `parameterDefinitions`

`SequencerProject` remains as a compatibility alias while the language moves from project-first to document-first.

The direction is:

```text
Document
  Entities
  Relationships
  Properties
  Timeline Events
  Validation
```

The document should not own history, UI stores, audio engine state, or observers. Those are runtime services around the document.

## Timeline Events

`TimelineEvent` is a generic document concept. It represents something that happens at a beat time inside a pattern, but it is not inherently audio, MIDI, or parameter automation.

Music events may not target parameters. A note event, for example, can carry pitch, duration, and velocity as musical data without pretending to reference a parameter.

Automation and control events should target parameters. If an event represents setting, ramping, or triggering an entity property, its `target` should reference the parameter being controlled.

This keeps core timeline storage general while allowing domain packages, such as `@sequencer/music`, to define musical event shapes above core.

## Entities

Every durable object is an entity:

```ts
interface Entity {
  id: EntityId;
  key?: string;
  name: string;
}
```

`id` is storage identity. It is unique and generated.

`key` is semantic identity. Examples include `master.bus`, `track.volume`, `analog.filter.cutoff`, or `midi.port.1`.

`name` is human-facing.

## Relationships

Relationships are first-class entities:

```ts
interface Relationship extends Entity {
  source: EntityRef<Entity>;
  target: EntityRef<Entity>;
}
```

A pattern placement is a relationship between a track and a pattern with timing behavior attached. Future routing, modulation, mapping, MIDI, and graph connections should use the same idea.

## Parameters And Properties

The current code uses `ParameterDefinition` and `Parameter`.

The architectural direction is broader:

```text
Entity
  Property Instance
    Property Type
```

Parameters are likely the first implementation of a more general property system. Track volume, filter cutoff, project tempo, window width, theme, sample rate, and track color are all properties. Some affect audio, some affect UI, some affect document behavior; core should not need special cases for those domains.

For now, default track parameter definitions are shared by semantic key:

```text
100 tracks
3 shared parameter definitions
300 parameter instances
```

## Operations

The long-term editing primitive is `Operation`:

```ts
interface Operation {
  readonly name: string;
  execute(document: SequencerDocument): void;
  undo(document: SequencerDocument): void;
}
```

`Command` remains as a compatibility alias while the codebase moves to operation-first language.

`CompositeOperation` groups many operations into one history entry. This replaces a separate transaction concept:

```ts
const operation = new CompositeOperation("Create Track");

operation
  .add(...)
  .add(...)
  .add(...);

store.execute(operation);
```

The history sees one operation. Undo sees one operation. Observers see one operation. Internally, it can be many edits.

The editing flow is:

```text
UI action
  DocumentStore
  Operation
  Document mutation
  History
  Observers
```

Operations support undo and redo through `OperationHistory`. `CommandHistory` remains as a compatibility alias.

`DocumentStore` owns editor state around the document:

```text
DocumentStore
  Document
  History
  Selection
  Clipboard
  Event Bus
```

Persistent state lives in the document:

```text
Tracks
Patterns
Timeline
Parameters
Relationships
```

Ephemeral editor state lives in the store:

```text
Selection
Clipboard
History
Hover state
Open inspectors
Current tool
```

This distinction is important: saving and reloading a document should not necessarily preserve clipboard contents, undo history, hover state, or the current tool.

## Observers

Views should listen to document changes, not to each other.

The intended flow is:

```text
Timeline
Mixer
Inspector
  all observe
DocumentStore
```

Renaming a track should update every relevant view because they observe the document editing pipeline, not because timeline, mixer, and inspector know about one another.

## Layer Boundaries

Core:
Entities, references, registries, relationships, timelines, properties/parameters, validation, serialization, commands, history, document store.

Engine:
Scheduling, playback interpretation, pattern expansion, automation evaluation, and translation from document state into runtime events.

MIDI / Audio / DSP:
Device IO, synthesis, sampling, effects, audio graphs, timing backends.

UI:
Svelte views, stores, controls, inspectors, timeline editing surfaces. UI dispatches operations and renders document state.

## Decision 001: Time

Time is represented internally as floating-point beats, not steps.

Reason: this allows arbitrary resolution, tuplets, swing, free placement, and alternative UI representations without changing the underlying model.
