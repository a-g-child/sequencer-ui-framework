# Editor Framework

This document captures the current editor architecture after the renderer and
velocity-lane work. It is a snapshot of the shape the code is converging on,
not a promise that every name is final.

## Stack

```text
Workbench
  v
Panels
  v
Sessions
  v
RenderModelBuilder
  v
RenderModel
  v
Renderer
  v
Subviews
  v
Tools
```

## Workbench

The workbench owns the application frame: top bar, side rail, center workspace,
and bottom status/runtime surfaces.

It should stay boring. The workbench arranges panels; it should not know how a
pattern renderer, velocity lane, timeline event, or note operation works.

## Panels

Panels are application-facing surfaces.

Examples:

```text
TransportPanel
TimelinePanel
Pattern Workspace
InspectorPanel
RuntimePanel
```

Panels connect app state, controllers, sessions, and components. They are
allowed to know application callbacks, but they should avoid owning persistent
document state.

## Sessions

Sessions own transient editor state.

```text
PatternEditorSession
  viewport
  active renderer
  active tool
  hover
  panning
  overlays
```

Sessions may derive from the document, but they should not duplicate document
truth. The document owns notes, patterns, tracks, placements, and parameters.
The session owns how an editor is currently looking at them.

## Render Model Builder

The builder is the join point between persistent document data and transient
session state.

```text
Document
  +
Session
  +
Renderer
  v
RenderModel
```

The builder should produce stable component-facing data. Components consume the
result; they should not need to ask the document or session how to interpret it.

## Render Model

The render model is the editor's visual contract.

For pattern editing, it is moving toward:

```ts
type PatternRenderModel = {
  lanes: RenderLane[];
  items: RenderItem[];
  overlays: PatternOverlay[];
  attributes: PatternAttribute[];
};
```

Today, the important primitives are:

```text
RenderLane
RenderItem
Overlay
```

`RenderItem.source` carries the domain object underneath the visual item. For
music note editing, that source is currently a note view. For automation it
could be an automation point. For graph editing it could be a node or handle.

The framework should speak lanes, items, overlays, tools, and viewport. Music
should speak notes, velocity, automation, patterns, and expression.

## Renderer

A renderer decides how the document appears in the main canvas.

Current examples:

```text
PianoRollRenderer
DrumRackRenderer
```

Both can read the same pattern and produce different lanes and items.

```text
Pattern
  v
Renderer
  v
RenderLane[]
RenderItem[]
```

The renderer owns conversion from domain semantics to visual geometry. The
canvas should not know that one renderer used MIDI pitch and another used drum
lanes.

## Subviews

Velocity showed that not every visual surface is a renderer.

A subview augments the active renderer instead of replacing it. It consumes the
same render model and visualizes one attribute or secondary editing surface.

Examples:

```text
Velocity
Chance
Probability
Aftertouch
Modulation
Expression
Automation
Controller lanes
```

The distinction:

```text
Renderer
  chooses the main visual interpretation

Subview
  edits or displays an attribute of the rendered items
```

This mirrors the shape of professional DAWs: the main editor view stays stable,
while secondary lanes expose musical intent.

## Tools

Tools act on interaction items.

```text
RenderInteractionItem
  source
```

The framework-level interaction language is item-shaped. A note tool can still
extract `item.source` and treat it as a note, but the context itself should not
need to mention notes.

Current note tools:

```text
SelectTool
DrawNoteTool
MoveNoteTool
ResizeNoteTool
EraseNoteTool
```

Future tools can reuse the same shape:

```text
MoveAutomationPointTool
ResizeControllerEventTool
EditGraphNodeTool
```

## Lane Providers

Lane providers are the likely next framework concept.

```text
Pattern
  v
LaneProvider
  v
Renderer
  v
RenderLane[]
```

Examples:

```text
PianoRollLaneProvider
  128 MIDI pitches

GeneralMidiDrumProvider
  36 Kick
  38 Snare
  42 Closed Hat

PatternGridProvider
  Kick
  Snare
  Bass
  Lead

AutomationProvider
  Volume
  Pan
  Cutoff
```

This makes renderers more data-driven and keeps lane identity separate from
visual presentation.

## Phase 6: Expressive Editing

The next phase is expressive editing.

The goal is not just sequencing events. It is editing musical intent:

```text
Velocity
Probability
Humanisation
Articulation
Automation
Expression
```

Each feature should strengthen the same architecture:

```text
Pattern Workspace
  Renderer
    Items
  Subviews
    Attributes
  Tools
    Operations
```

The framework becomes generic by speaking visual interaction primitives. Music
stays expressive by mapping those primitives back to notes, velocities,
automation, and performance data.
