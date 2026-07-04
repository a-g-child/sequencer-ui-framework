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
    sample-grid
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

### Sample Grid

The sample grid treats pitch as fixed sample lanes. A drum rack is one preset
mapping for this view; a step sequencer can use the same lane-based surface.

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
    SampleGridRenderer

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

## Sample Grid Lane Metadata

Sample Grid should grow through lane definitions, not new editor operations.

```ts
interface SampleGridLane {
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

The Sample Grid provider should be organised around 4x4 pad pages. A pad maps a
MIDI trigger to sample playback; it is not a VST hosting surface. Sampler DSP,
envelopes, and audio-engine concerns belong later in the runtime/audio layer.

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

SampleGridLaneProvider
  Kick, Snare, Hat, sample lanes

PatternGridLaneProvider
  Step 1, Step 2, Step 3

AutomationLaneProvider
  Parameter lanes
```

This keeps the renderer framework useful beyond piano-roll note editing.

## Velocity And Automation

Velocity should not require a separate panel. It can be another renderer output.
Velocity and probability are composition-level note attributes. Automation is
track-level interpretation for the clip: a one-bar pattern can expose a
parameter lane for track volume, pan, or future FX parameters, then playback can
evaluate that curve while the clip loops or plays one-shot.

```text
Piano Roll
  notes
  velocityItems

Sample Grid
  lanes
  hits
  lane-local velocityItems

Automation
  lanes
  points and segments
```

The canvas still renders visual primitives. Renderers decide whether an item is
a rectangle, a point, a curve segment, or a velocity bar.

The first automation subview is a single lane with a parameter selector. It can
render the current value as a Bezier path before persistent automation points
exist. Later curve tools should use the same Bezier equation for rendering and
for sampling parameter values at playback time.

Curve helpers should stay outside the Svelte component so editing tools,
rendering, and playback can share the same Bezier interpolation instead of each
layer inventing its own curve math.

Automation editing should be pointer-first for touch screens: press the lane to
create a point, drag a point to move it, and long-press a point to remove it.
The same interactions should work with mouse, pen, and touch input.

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
Sample Grid
Velocity lane
Lane providers
Pattern Grid renderer
Automation renderer
Controller lane renderer
MIDI playback
```

Each step should make the renderer framework more general without forcing audio
or synthesis concerns into the UI layer.
