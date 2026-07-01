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

## Phase 5: Framework Consolidation

The next phase is consolidation, not feature expansion.

The goal is to make the framework own the application shape, while music becomes
a client of reusable editor and UI concepts.

Completed foundation:

- Core document model
- Operations
- Services
- Sessions emerging in editors
- Workbench scaffold
- UI primitives under `framework/ui`
- Panels extracted from `App.svelte`
- Framework vocabulary documented

### Phase 5.1: Framework Consolidation Close-Out

Status: complete.

Completed in this slice:

- Pattern editor code moved under `music/pattern`
- `framework/editor` vocabulary introduced
- `framework/application/SessionManager` introduced
- `PatternRenderModelBuilder` introduced
- `RendererRegistry` seam introduced
- Pattern sessions and render models made explicit framework clients

Consolidation targets:

- `framework/application/SessionManager`
- `framework/application/Workspace`
- `framework/application/Panel`
- `framework/application/PanelDefinition`
- `framework/editor/Session`
- `framework/editor/Viewport`
- `framework/editor/RenderModel`
- `framework/editor/RenderModelBuilder`
- `framework/editor/Renderer`
- `framework/editor/Tool`
- `framework/editor/Overlay`
- `framework/editor/InteractionBuilder`
- `framework/theme/tokens.css`
- `framework/theme/dark.css`
- `framework/theme/light.css`
- `framework/theme/broadcast.css`
- `framework/theme/touch.css`
- renderer registry
- workspace persistence

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
    drum-rack/
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

After framework consolidation, feature work can continue on stronger ground:

- Music editors
- Automation
- Audio
- MIDI
- Plugins
- Workbench docking
- Multi-window or multi-monitor layouts

Audio should enter as another service, not as a dependency of the UI framework.
The framework should not change shape when playback becomes real.
