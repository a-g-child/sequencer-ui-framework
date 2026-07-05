# Architectural Roadmap

This is not a feature roadmap. It is a map of architectural phases and the
consolidation work needed to keep the codebase coherent as it grows.

## Completed Phases

### Phase 1: Core

- Document model
- Entities and relationships
- Timelines and patterns
- Parameters and parameter definitions
- Validation

### Phase 2: Music

- Musical event shapes
- Notes
- Piano-roll view models
- Pattern interpretation

### Phase 3: Operations

- Document mutations through operations and controllers
- Undo and redo
- Composite edits
- Selection and clipboard around the document

### Phase 4: Editor

- Pattern editor
- Tools
- Viewport state
- Interaction context
- Render models
- Component extraction
- Panel extraction

### Phase 5: Framework Consolidation

Status: complete.

Phase 5 moved the repository from editor infrastructure toward a reusable
creative-application framework. The framework now owns the application shape,
while music is a client of reusable editor and UI concepts.

Completed:

- Workbench
- UI framework
- Theme tokens
- Editor sessions
- `RenderModelBuilder`
- Renderer registry
- Pattern workspace direction
- Piano Roll renderer
- Sample Grid renderer
- Velocity subview
- Render lanes and render items
- Render-item interaction context
- UI primitives under `framework/ui`
- Panels extracted from `App.svelte`
- Framework documentation

The remaining framework ideas are refinements, not blockers:

- `EditorTool<TSource>`
- generic `InteractionContext<TSource>`
- lane providers
- subview registry
- workspace persistence

## Phase 6: Expressive Editing

The next phase is product work on top of the framework.

The goal is expressive editing: velocity, probability, humanisation,
articulation, automation, and the details that make a sequence feel performed
rather than merely placed on a grid.

Phase 6 should focus on editing before playback. Playback and MIDI will be more
valuable once the editor can create patterns that are enjoyable to hear.

### Sprint 1: Musical Expression

- Velocity polish
- Probability lane
- Humanise
- Quantise
- Scale snap

### Sprint 2: Drum Workflow

- Drum lane metadata
- General MIDI drum provider
- Custom kits
- Lane colours
- Lane icons
- Fold empty lanes

### Sprint 3: Pattern Workflow

- Pattern Grid renderer
- Step sequencing
- Accent
- Ratchets
- Microsteps

### Sprint 4: Automation

- Automation subview
- Bezier editing
- Parameter lanes
- Curve tools

### Sprint 5: Playback

- Transport clock
- Scheduler
- MIDI output
- Preview playback

## Phase 8: Real Outputs

This phase is not about inventing more architecture. It is about making the
scheduler talk to the outside world through the output architecture that now
exists.

Every item in this phase should be another `PlaybackOutput`.

- Web MIDI output for the current TypeScript runtime
- CoreMIDI, WinMM, and ALSA abstraction later in native code
- Simple software instrument, even a sine-wave synth, to prove the pipeline
- Metronome or click track
- MIDI clock output

The scheduler should remain unchanged. It emits playback events. Outputs decide
how to execute them.

## Phase 9: Voice and Audio

This is where C++ or Rust starts earning its keep.

Audio should enter through the output boundary:

```text
AudioOutput
  -> VoiceManager
  -> DSP Graph
  -> Audio Device
```

The scheduler still knows nothing about oscillators, voices, buffers, or audio
drivers.

Voice allocation belongs inside `AudioOutput`, not in the scheduler.

## Phase 10: Plugin Host

Once real outputs and audio exist, the plugin host can become another consumer
in the playback chain.

```text
PlaybackEvent
  -> Plugin
  -> Audio
  -> Output
```

The plugin host should not require a new scheduler shape. It should consume
playback events, transform or generate audio, and pass execution onward through
the same output-side architecture.

## Target Shape

```text
apps/ui/src/lib/
  framework/
    application/
    editor/
    theme/
    ui/
  music/
    pattern/
    timeline/
    piano-roll/
    sample-grid/
    automation/
  panels/
```

Framework contains reusable creative-application infrastructure.

Music contains musical semantics and specializations.

Panels compose app-facing surfaces.

## Session Direction

Workbench should eventually own sessions through a session manager.

```text
SessionManager
  PatternEditorSession
  TimelineSession
  InspectorSession
  RuntimeSession
```

Panels consume sessions. Sessions own transient UI state. Documents own
persistent state.

## Render Direction

Rendering should converge on builders.

```text
Document
  +
Session
  v
RenderModelBuilder
  v
RenderModel
  v
Renderer / Component
```

Renderers should render. Builders should build render models. This keeps
rendering stateless and makes the same document usable across different
sessions and workspaces.

## Future Feature Layers

After expressive editing, feature work can continue on stronger ground:

- Audio
- MIDI
- Plugins
- Workbench docking
- Multi-window or multi-monitor layouts

Audio should enter as another service, not as a dependency of the UI framework.
The framework should not change shape when playback becomes real.
