# UI And Editor Framework

This document captures the working rules for the UI framework as it emerges.
It is a guide for refactors, not a complete implementation plan.

The goal is to keep the lower layers reusable and non-musical, while musical
editors become clients of the framework rather than owners of it.

The document stores creative intent. Derived systems--rendering, editing,
performance, and playback--interpret that intent without destroying it whenever
practical.

## Vocabulary

### Document

Persistent state.

The document is the durable model that can be saved, loaded, diffed, validated,
tested, and synchronized. Tracks, patterns, placements, notes, parameters,
relationships, and timeline data belong here.

The document should not contain hover state, scroll state, current tools,
temporary selection rectangles, open panels, or draft input values.

### Session

Transient editor state.

A session belongs to an application surface or editor panel. It owns the state
needed to interact with a document without becoming part of the document:

- viewport
- scroll
- hover
- panning
- active tool
- temporary selections
- drafts
- collapsed and expanded groups
- panel-local UI state

The emerging shape is:

```text
ApplicationSession
  PatternEditorSession
  TimelineSession
  InspectorSession
  RuntimeSession
```

Every panel should eventually have one session. Sessions may derive from the
document, but they should not duplicate persistent document state.

### Operation

Document mutation.

User intent becomes an operation. Operations change the document through the
document editing pipeline, and history records those changes. Components and
panels should not mutate the document directly.

```text
UI Action
  Session / Controller
  Operation
  Document
  History
  Observers
```

### Render Model

Document plus session view.

A render model is the stable, component-facing shape produced from persistent
document state and transient session state. Rendering should be a pure result of
those inputs wherever possible.

```text
Document
  +
Session
  =
Render Model
```

This allows the same document to produce different views in different sessions
without mutating the document.

### Component

Render where possible.

Components should prefer props and render models over direct document access.
They may emit UI events, but should avoid owning document mutation rules.

Small UI primitives, such as buttons and toolbars, belong in the framework UI
layer. Domain components, such as piano-roll notes, belong in musical editor
layers unless they become genuinely reusable.

### Panel

App-facing composition.

Panels are the surfaces that the application arranges: transport, timeline,
pattern editor, inspector, runtime status, and future graph or automation
surfaces.

Panels connect app/session state to components. They are allowed to be aware of
application callbacks and view models, but should avoid becoming document
stores themselves.

### Framework

Reusable non-musical layer.

Framework code should not know about notes, patterns, MIDI, piano rolls, or
drum racks. It should provide general UI and editor concepts:

```text
framework/
  ui/
    Button
    Panel
    Toolbar
    Splitter
    Tabs
    NumberField
    ScrollArea
    Menu
    ContextMenu
  editor/
    Session
    Viewport
    RenderModel
    RenderModelBuilder
    Renderer
    InteractionBuilder
    Tool
    Overlay
  application/
    Workbench
    Workspace
    Panel
    PanelDefinition
    SessionManager
  theme/
    tokens.css
    dark.css
    light.css
    broadcast.css
    touch.css
```

The framework is useful only if it can serve more than the sequencer. A camera
cue editor, lighting editor, or automation editor should be able to reuse these
parts without importing musical semantics.

### Music

Notes, patterns, MIDI, and musical semantics.

Music-specific code specializes the framework. Pattern editors, piano-roll
renderers, drum-rack renderers, note hit testing, musical snapping, and MIDI
concepts belong above the framework layer.

The desired inversion is:

```text
Pattern Editor
  uses
Framework Editor
```

not:

```text
Pattern Editor
  owns
Editor Framework
```

## Dependency Rule

Dependencies should point downward toward more general layers.

```text
Application
  Panels
  Music Editors
  Framework Editor
  Framework UI
  Document / Operations
```

Avoid upward dependencies. A button should not know about transport. A renderer
should not know about the application shell. A document operation should not
know about Svelte.

Nothing inside `framework/` may import application panels, musical editors, or
domain-specific music modules. Framework is the reusable layer. Application,
music, panels, and components may depend on framework; framework may not depend
on them.

```text
Application
Panels
Music
Components
  |
  v
Framework
```

Inside the editor stack, dependencies should also move in one direction:

```text
Component
  v
RenderModel
  v
Session
  v
Document
```

Never upwards. Components render derived data. Render models are built from
session and document state. Sessions hold transient state. Documents hold
persistent state.

The practical rule:

```text
Components consume render models.
Render models are built from sessions and documents.
Sessions hold transient UI/editor state.
Operations mutate documents.
Documents hold persistent state.
```

## Current Direction

The composition root should become boring:

```svelte
<AppLayout>
  <TransportPanel />
  <TimelinePanel />
  <PatternEditor />
  <InspectorPanel />
  <RuntimePanel />
</AppLayout>
```

Once the app is mostly composition, the next work should focus on polishing the
framework boundaries rather than extracting components for their own sake.

Good next moves:

- introduce `framework/editor`
- identify generic viewport, renderer, tool, overlay, and interaction concepts
- introduce `framework/application/SessionManager`
- formalize render model builders
- introduce a renderer registry
- evolve the workbench without adding docking too early
- split theme into framework-owned theme files

Bad next moves:

- moving files only to make the tree look tidy
- putting music-specific behavior into framework modules
- letting sessions duplicate persistent document state
- letting components bypass operations to mutate documents
