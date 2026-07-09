# Principles

These are not APIs, implementation notes, or current architecture decisions.
They are the project DNA: the ideas that should keep shaping the sequencer as
the codebase grows.

## Three Pillars

Sequencer is centred on three orthogonal ideas:

```text
Creative Intent
      |
  Document
  Devices
  Playback
```

The document answers what the creator intended.

Devices answer how that intent can be realised.

Playback answers when it should happen.

Each pillar should stay independent enough to be replaced, extended, and
recombined without collapsing into the others.

## Preserve Intent

Documents store creative intent.

They should describe what the user meant: tracks, patterns, notes, placements,
parameters, timing, performance choices, relationships, and structure.

Documents should not store derived execution state just because a runtime system
currently needs it. If something can be rebuilt from the document, it should not
become canonical document state.

## Derive, Don't Duplicate

Runtime models are derived from the document.

Playback models, render models, inspector models, timeline views, and future
analysis models should be rebuilt from source intent rather than treated as
second documents that must be kept in sync by hand.

Duplication creates disagreement. Derivation creates a single source of truth.

## Layer Interpretation

Rendering, playback, editing, performance, automation, and export are
interpretations of the same document.

A note in the document can become a piano-roll rectangle, a sample-grid cell, a
scheduled MIDI event, a notation glyph, an automation trigger, or an analysis
item. None of those interpretations owns the note.

The document remains the shared source. Each layer explains it for a different
purpose.

## Swap Implementations, Not Interfaces

Important boundaries should survive implementation changes.

The TypeScript scheduler and a future Rust or C++ scheduler should implement
the same scheduler contract. A canvas renderer and a future WebGL renderer
should sit behind the same rendering concepts. A local output and a hardware
output should consume the same playback events.

Replacing an implementation should not require replacing the document,
operations, models, services, UI, or surrounding architecture.

## Execution Is Replaceable

Documents describe intent.

Builders derive runtime models.

Runtime models are consumed by replaceable execution systems.

Schedulers, renderers, outputs, and devices may be substituted without changing
the creative document.

This lets a JavaScript scheduler become a native scheduler, Web Audio become
native audio, a software synth become a hardware module, an internal clock
become an external clock, and a console output become a MIDI output without
rewriting the creative model.

See `docs/native-runtime.md` for the practical integration boundary for Rust,
C++, WebAssembly, or future embedded runtimes.

## Physical And Software Are Peers

A creative document should not depend on where a device executes.

Software devices, external MIDI devices, network devices, attached hardware
modules, and future native devices are interchangeable implementations of the
same creative abstraction.

Tracks compose intent. Devices realise it. Outputs execute it.

This means a document can reference a device even when that implementation is
currently unavailable. Missing hardware should be restorable. A disconnected
module should behave more like a missing plugin than deleted creative work.

## Framework Before Feature

New domains should extend the framework rather than bypass it.

When adding a capability, first ask what stable concept it belongs to:
document, operation, service, renderer, playback model, output, session, or
view model.

Features should make the framework richer. They should not carve private paths
around it.

## New Ideas Should Not Require New Frameworks

The architecture is healthy when new musical ideas require new devices, graph
presets, nodes, and executor implementations, not new framework abstractions.

Before adding another layer, ask whether the idea can be expressed through the
existing pipeline:

```text
Descriptor
  -> Execution Graph
  -> Runtime Graph
  -> Executor
```

A mono synth, drum sampler, delay, LFO device, or MIDI arpeggiator should prove
the framework by using it. If each new musical family needs a private pathway,
the abstraction is not finished. If it needs only new nodes, device behavior,
and executor support, the architecture is doing its job.

## Intent Is Edited, State Is Observed

User actions should edit intent through operations.

Runtime state can be observed, previewed, logged, scheduled, or visualized, but
it should not quietly become the place where creative truth lives.

This keeps undo, redo, serialization, validation, collaboration, and future
native runtimes pointed at the same source.

## Boundaries Make Creativity Safer

Clear boundaries are not bureaucracy. They make experimentation cheaper.

When documents, renderers, schedulers, outputs, and services each have a clean
job, the project can gain new editors, playback engines, visualizations, and
runtime backends without turning every feature into a rewrite.

Good boundaries let the sequencer stay playful.
