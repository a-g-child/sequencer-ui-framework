# Pattern Renderers

Pattern renderers let the same pattern document appear through different visual
interpretations without changing the stored data.

The first proof is deliberately small:

```text
Pattern
  notes: C1, D1, F#1, C1

  v

PatternEditorSession
  rendererRegistry
    piano-roll
    drum-rack
```

## Same Data, Different Renderers

### Piano Roll

The piano roll treats note pitch as vertical position.

```text
Note       1       2       3       4
C2   --------------------------------
B1   --------------------------------
A#1  --------------------------------
A1   --------------------------------
G#1  --------------------------------
G1   --------------------------------
F#1          [note]------------------
F1   --------------------------------
E1   --------------------------------
D#1  --------------------------------
D1           [note]----------[note]--
C#1  --------------------------------
C1   [note]--------------------------
```

### Drum Rack

The drum rack treats pitch as fixed lanes.

```text
Lane       1       2       3       4
F#1 Hat            [hit]------------
D1  Snare          [hit]----[hit]---
C1  Kick  [hit]---------------------
```

Both views are reading the same pattern notes. The renderer owns the mapping
from musical data to visual lanes.

## Current Shape

The current implementation has the right seam:

```text
PatternEditorSession
  RendererRegistry
    PianoRollRenderer
    DrumRackRenderer

PatternRenderModelBuilder
  document + session + renderer
  -> PatternRenderModel

PatternCanvas
  PatternGrid
  PatternNotes
  PatternOverlays
```

This proves the renderer boundary, but the render model still carries some
music-aware concepts such as pitch, notes, and beat-derived placement.

## Next Refinement

The next useful move is to make the component-facing render model more general.
The renderer should convert domain concepts into pure visual primitives.

```ts
interface RenderLane {
  id: string;
  label: string;
  y: number;
  height: number;
}

interface RenderItem {
  id: string;
  x: number;
  width: number;
  laneId: string;
  selected: boolean;
  hovered: boolean;
  source: unknown;
}
```

At that point the canvas does not know about notes, pitch, velocity, or beats.
It only renders lanes and items. The domain source stays attached for selection
and future operations.

```text
Renderer
  domain data
  viewport
  session state
  v
RenderLane[]
RenderItem[]
  v
Canvas DOM
```

## Drum Rack Lane Metadata

Drum Rack should grow through lane definitions, not new editor operations.

```ts
interface DrumLane {
  pitch: number;
  name: string;
  colour?: string;
  icon?: string;
}
```

Initial defaults can follow common drum mappings:

```text
36 Kick
38 Snare
42 Closed Hat
46 Open Hat
49 Crash
51 Ride
```

Later sources can include General MIDI, user kits, sample kits, and hardware
mappings. The renderer should consume lane definitions rather than discover all
lanes from notes forever.

## Lane Providers

Lane providers are the likely next abstraction.

```text
Pattern
  v
LaneProvider
  v
Renderer
```

Examples:

```text
PianoRollLaneProvider
  128 MIDI pitches

DrumRackLaneProvider
  Kick, Snare, Hat, kit lanes

PatternGridLaneProvider
  Step 1, Step 2, Step 3

AutomationLaneProvider
  Parameter lanes
```

This keeps the renderer framework useful beyond piano-roll note editing.

## Velocity And Automation

Velocity should not require a separate panel. It can be another renderer output.

```text
Piano Roll
  notes
  velocityItems

Drum Rack
  lanes
  hits
  lane-local velocityItems

Automation
  lanes
  points and segments
```

The canvas still renders visual primitives. Renderers decide whether an item is
a rectangle, a point, a curve segment, or a velocity bar.

## Naming Direction

`PatternEditor` is becoming more like a pattern workspace:

```text
Pattern Workspace
  Toolbar
  Session
  RendererRegistry
  Canvas
  Tools
```

The piano roll is one renderer inside that workspace. The name does not need to
change immediately, but this is the direction of the mental model.

## Phase 6 Focus

Phase 6 should stay focused on strengthening renderers before broad feature
work:

```text
Piano Roll
Drum Rack
Velocity lane
Lane providers
Pattern Grid renderer
Automation renderer
Controller lane renderer
MIDI playback
```

Each step should make the renderer framework more general without forcing audio
or synthesis concerns into the UI layer.
