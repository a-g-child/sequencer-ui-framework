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

## Phase 8: Device And Routing Foundation

This phase should turn the placeholder engine into a reliable playable
groovebox. The framework shape is now strong enough; the next investment should
make clips, tracks, devices, playback, and outputs connect through one
execution path.

Priority order:

1. Device model
2. Output routing
3. Web MIDI
4. Better internal synth and sampler proofs
5. Clip matrix UX polish
6. Scheduler diagnostics

Device model comes first because it becomes the bridge between clips, tracks,
MIDI, synths, samplers, and future hardware modules. Without it, Web Audio,
MIDI, and samplers will each grow their own routing assumptions.

The current path is:

```text
Clip
  -> Track
  -> DeviceInstance
  -> PlaybackEvent.destination
  -> RuntimeDevice
  -> OutputManager
  -> Output
```

This replaces the weaker shape where clips effectively target playback outputs
directly.

### Phase 8.1: Runtime Devices

Status: complete.

Completed:

- `packages/device`
- `DeviceDescriptor`
- `DeviceInstance`
- `RuntimeDevice`
- `DeviceFactory`
- `DeviceRegistry`
- `RuntimeDeviceRegistry`
- `PlaybackDeviceManager`
- `PlaybackEvent.destination`
- playback events routed to runtime devices
- diagnostic outputs still receive the full event stream

The runtime shape is now:

```text
Document
  -> PlaybackModelBuilder
  -> PlaybackModel
  -> Scheduler
  -> PlaybackEvent[]
  -> PlaybackDeviceManager
  -> RuntimeDevice
  -> OutputManager
  -> WebAudio / Web MIDI / diagnostics
```

The scheduler has disappeared from execution. It schedules and emits
deterministic events.

### Phase 8.2: Golden Device

The next implementation milestone should make `BasicSynthRuntimeDevice` the
golden reference implementation of a runtime device.

This phase should be treated as reference implementation work rather than more
architecture-first development. The architecture is no longer the primary
product risk. The next risk is proving that the architecture produces a
fantastic instrument.

The Basic Synth should not try to become a flagship synth. It should become
complete enough to validate every layer:

- oscillator
- ADSR
- portamento
- LFO
- filter
- amplitude
- voice manager
- parameter binding
- automation

The guiding question changes from "did we introduce the right abstraction?" to
"did we make the golden device better?"

The runtime device should orchestrate rather than own every primitive:

```text
BasicSynthRuntimeDevice
  -> VoiceManager
  -> Voice
  -> Oscillator
  -> Envelope
  -> Filter
  -> AudioOutput
```

The likely package boundary is `packages/audio`, with reusable DSP primitives
rather than synth-specific concepts:

- `voice.ts`
- `voice-manager.ts`
- `oscillator.ts`
- `envelope.ts`
- `filter.ts`

Reference behavior tests should start here:

- `NoteOn` allocates a voice
- `NoteOff` releases a voice
- automation updates device parameters
- playback events reach the correct runtime device

See `docs/reference-device.md` for the golden device narrative and checklist.
Use `docs/golden-device-checklist.md` as the living day-to-day tracker for this
phase.

### Phase 8.3: Device Graph

Once the reference instrument is stable, grow from a single device assignment
toward device chains, sends, returns, and mixer behavior.

```text
Track
  -> Synth
  -> Filter
  -> Delay
  -> Mixer
  -> Output
```

### Phase 8.4: External Devices

External devices should use the same runtime device contract:

- Web MIDI
- hardware modules
- network devices
- future controller or robotics targets

### Phase 8.5: Native Runtime Preparation

Native implementations should replace execution systems behind the same
contracts:

- Rust or C++ runtime devices
- native scheduler
- native audio engine
- native hardware bridges

Phase 8 should stop at preparation and boundary definition. The first native
implementation work belongs in Phase 9 as an adapter spike, not as a full audio
engine rewrite.

Plugin hosting should remain postponed until the internal runtime device and
native runtime contracts are stronger. VST, CLAP, and LV2 can later become
adapters rather than the foundation.

### Historical Phase 8 Notes

The original Phase 8 planning was:

#### Device Package

Add `packages/device` with the vocabulary before expanding execution behavior:

- `DeviceDescriptor`
- `DeviceInstance`
- `DeviceCapability`
- `DevicePort`
- `DeviceParameter`
- `DeviceRegistry`

The first implementation should be simple, but the contract should be strong
enough for software devices, external MIDI devices, attached hardware modules,
network instruments, robotics targets, and lighting targets to become peers.

#### Document Device Assignment

The document should be able to persist track-level device assignment:

```text
Track
  -> DeviceInstance
  -> DeviceDescriptor
  -> Capabilities
  -> Parameters
```

The document stores creative assignment and parameter intent. It should not
store derived runtime routing state.

Missing devices should stay in the document as missing assignments, not deleted
creative work.

#### Playback Destination

`PlaybackEvent` carries destination information derived from the document and
device assignment:

```text
PlaybackEvent.destination
  trackId
  deviceInstanceId
  port?
```

The scheduler still emits deterministic events. It should not know how the
destination is executed.

#### OutputManager Routing

`OutputManager` should route events by destination instead of only broadcasting
every event to every active output.

Initial routing behavior:

- route events to the output selected by destination
- use track and device assignment when no explicit output is present
- default to `WebAudioOutput` or `ConsoleOutput` when no route is configured
- keep fan-out available for diagnostics outputs such as event logging and
  statistics

#### Internal Device Stubs

Add basic devices behind the device contract:

- `BasicSynthDevice`
- `BasicSamplerDevice`
- `ExternalMidiDevice`

These should be proof devices, not final instruments. A basic synth behind the
right device contract is more valuable than a polished synth with private
routing assumptions.

#### Simple UI

Add enough UI to prove the model:

- track device selector
- device parameter panel
- output status

The UI should present creative devices, not technical transport details. A
hardware module should appear as a new device option rather than a low-level
USB or MIDI event.

#### Web MIDI

After device routing exists, add `WebMidiOutput` as another `PlaybackOutput`.

`ExternalMidiDevice` should target that output through the same destination and
routing model as the internal synth and sampler devices.

The scheduler should remain unchanged. It emits playback events. Devices and
outputs decide how to execute them.

## Phase 9: Native Runtime Spike

Phase 9 should prove the native seam before building a full native engine.

The goal is not "rewrite the runtime in Rust." The goal is to show that native
execution can sit under the existing contracts:

```text
Document
  -> PlaybackModelBuilder
  -> PlaybackModel
  -> Scheduler
  -> PlaybackEvent[]
  -> RuntimeDevice
  -> DeviceCommand[]
  -> Native Adapter
```

The current TypeScript scheduler and WebAudio executor remain the reference
implementations. Native adapters must match those contracts before they try to
outperform them.

### Phase 9.1: Serializable Runtime Schemas

Define shared plain-data shapes for the native boundary:

- `PlaybackModel`
- `ClockState`
- `PlaybackEvent`
- `DeviceCommand`

These schemas should avoid document objects, Svelte state, class instances, and
runtime registries. They are the data that Rust, C++, WebAssembly, IPC, or a
future embedded runtime can consume without knowing the editor.

### Phase 9.2: NativeSchedulerAdapter

Add a TypeScript adapter with the same interface as the current scheduler.

The first implementation should wrap the TypeScript scheduler:

```text
PlaybackService
  -> NativeSchedulerAdapter
  -> TypeScriptScheduler
```

That proves the service can swap scheduler implementations without changing the
document, model builder, UI, output manager, or runtime device path.

Later the same adapter can call WebAssembly or a native process:

```text
PlaybackService
  -> NativeSchedulerAdapter
  -> WASM / native scheduler
```

### Phase 9.3: NativeAudioAdapter

Add a native audio adapter that accepts device commands but does no DSP yet.

The first version can log, acknowledge, and expose diagnostics for commands:

- `voice:start`
- `voice:release`
- `voice:steal`
- `parameter:set`
- `panic`

This proves the command bridge before introducing real-time audio constraints.

### Phase 9.4: VoiceAction To DeviceCommand

Convert the current `VoiceAction` stream into a more general `DeviceCommand`
stream.

```text
PlaybackEvent
  -> RuntimeDevice
  -> VoiceAction
  -> DeviceCommand
  -> Audio Adapter
```

The bridge should preserve the current WebAudio path while making native audio
an implementation choice.

### Phase 9.5: Scheduler Acceptance Tests

Add shared behavior tests proving that the TypeScript scheduler and native
adapter emit identical `PlaybackEvent` sequences for the same `PlaybackModel`.

The tests should cover:

- notes
- looped clips
- automation samples
- seeks
- stops
- deterministic event ids
- no duplicate lookahead events

This makes the TypeScript scheduler the readable specification for any native
scheduler implementation.

### Phase 9.6: Native Audio Proof

Only after the adapter and tests exist should the project build a native audio
proof:

- one oscillator
- one envelope
- one output stream
- command bridge only

The proof should replace execution, not the creative contracts.

### Recommended Technology Path

Start with Rust and WebAssembly for the scheduler contract because it can be
tested inside the current app and CI shape.

Use native Rust or C++ later for low-latency audio, device drivers, and
hardware-backed runtime devices.

## Phase 10: Native Audio And Device Execution

After Phase 9 proves the adapter seam, native audio can become a serious
runtime implementation.

Audio should enter through the runtime device and command boundary:

```text
RuntimeDevice
  -> DeviceCommand[]
  -> NativeAudioAdapter
  -> DSP Graph
  -> Audio Device
```

The scheduler still knows nothing about oscillators, voices, buffers, or audio
drivers.

Voice allocation belongs inside runtime devices and reusable audio packages,
not in the scheduler.

## Phase 11: Plugin Host

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
