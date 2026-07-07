# Device Model

Devices are the centre of Sequencer's creative pipeline.

Tracks compose intent. Clips provide time-based musical material. Devices
realise that material. Outputs execute the resulting events, audio, control, or
hardware messages.

```text
Document
  -> Track
  -> Clip
  -> Device
  -> Playback
  -> Output
```

This is a conceptual model, not an implementation plan. It defines the shape
the codebase should grow toward.

## Device

A device is anything that can realise track or clip intent.

Examples:

- internal synth
- sampler
- MIDI output target
- audio effect
- hardware synth module
- hardware audio module
- networked instrument
- OSC target
- robotics target
- lighting target

A device may be implemented in TypeScript, native audio code, external MIDI
hardware, an attached module, another computer, or a future runtime. The rest of
the creative model should not need to know.

The device model has three distinct layers:

```text
DeviceDescriptor
  -> DeviceInstance
  -> RuntimeDevice
```

The descriptor is static. It describes what kind of device exists: its name,
capabilities, ports, and parameters.

The instance is persistent. It lives in the document and stores the creator's
assignment and parameter values.

The runtime device is transient. It belongs to the current execution runtime and
can own loaded state, connections, voices, audio buffers, latency, and device
I/O. It is never saved as creative truth.

## Descriptor

A device descriptor explains what a device is.

```text
DeviceDescriptor
  id
  name
  vendor
  version
  kind
  parameters
  inputs
  outputs
  capabilities
  latency
```

Descriptors are how software devices, MIDI devices, hardware modules, and
network devices become peers.

## Parameters

Parameters are the automation surface of a device.

```text
DeviceParameter
  id
  key
  name
  kind
  defaultValue
  min
  max
  step
  unit
```

Automation should target device parameters rather than special-casing synths,
samplers, effects, MIDI CC, or hardware module controls.

## Capabilities

Capabilities describe what a device can do.

Examples:

- note input
- audio input
- audio output
- control input
- automation target
- MIDI target
- clock target
- transport target
- effect processor
- synth voice
- sampler voice

Capabilities let routing and UI adapt without knowing device internals.

## Inputs And Outputs

Devices can expose typed ports.

```text
DeviceInput
  id
  kind
  channels

DeviceOutput
  id
  kind
  channels
```

Initial port kinds:

- notes
- audio
- control
- clock
- transport

This allows the same model to describe a synth, an effect, a MIDI target, a
send/return module, or a hardware audio device.

## Device Graph

Initially, a track can target one device.

Later, a track can own a device graph.

```text
Track
  -> Sampler
  -> Filter
  -> Delay
  -> Output
```

The scheduler should not own this graph. It should emit playback events. Device
and output layers should decide how those events become audio, MIDI, control,
or hardware activity.

The device abstraction should mature before full audio graphs are built. Once
devices, descriptors, parameters, capabilities, and routing are stable, the
graph should emerge from those concepts rather than being invented separately.

## Device Registry

A registry makes devices discoverable.

```text
DeviceRegistry
  register()
  remove()
  devices()
  get()
```

Potential sources:

- built-in software devices
- Web MIDI devices
- future native MIDI devices
- attached hardware modules
- network devices
- mock devices for tests

The registry should allow a newly attached module to appear as a device without
changing the editor, scheduler, or document model.

At runtime, device factories create runtime devices from document instances:

```text
DeviceInstance
  -> DeviceFactory
  -> RuntimeDevice
```

If no factory exists for a descriptor, the runtime can create a missing device
placeholder. Playback can continue, the document remains intact, and the UI can
surface the missing device as a restorable creative assignment.

Native Rust, C++, WebAssembly, hardware-module, or browser implementations
should enter through factories and runtime devices rather than changing the
document shape. See `docs/native-runtime.md`.

## Recurring Shape

Sequencer is developing a repeated architectural rhythm.

```text
Registry
  RendererRegistry
  ClockRegistry
  OutputRegistry
  DeviceRegistry

Builder
  RenderModelBuilder
  PlaybackModelBuilder
  DeviceGraphBuilder

Runtime Model
  RenderModel
  PlaybackModel
  RuntimeDevice
  DeviceGraph

Consumer
  Renderer
  Scheduler
  PlaybackDeviceManager
  OutputManager
  Audio Engine
```

Devices should follow this same shape. That keeps the device layer consistent
with rendering, clocks, playback, and outputs instead of making it a special
case.

## Missing Devices

Documents should be able to reference devices that are not currently available.

If a hardware delay is unplugged, the document should still contain the delay
assignment, parameters, and automation. The device becomes missing, not
deleted.

When the device returns, the assignment should recover.

This gives physical modules the same project behavior users expect from missing
plugins or disconnected MIDI hardware.

## Device Modules

A device module is a discoverable device that may be physically attached,
networked, or otherwise external to the core runtime.

Physical modules may use a bus carrying power, I2S audio, I2C control,
hot-plug detection, wake, GPIO, and identity data.

Network modules may advertise the same descriptor over a different transport.

The transport is not the creative model. The descriptor is.

## Package Direction

Device concepts are not inherently music-specific. They can eventually live in
a package like:

```text
packages/device/
  device.ts
  descriptor.ts
  parameter.ts
  capability.ts
  registry.ts
```

Music packages can then interpret devices for tracks, clips, playback, and
automation without owning the generic device abstraction.
