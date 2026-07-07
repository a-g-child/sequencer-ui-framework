# Reference Device

The Basic Synth Runtime Device exists to demonstrate the complete
`RuntimeDevice` architecture.

It is not meant to be the flagship instrument. It is the golden device: the
smallest complete implementation that proves the framework can become a
fantastic playable instrument.

Future devices should look here before inventing new patterns.

## Purpose

The golden device should exercise the full runtime path:

```text
Document
  -> DeviceInstance
  -> PlaybackModel
  -> Scheduler
  -> PlaybackEvent.destination
  -> PlaybackDeviceManager
  -> BasicSynthRuntimeDevice
  -> Output
```

The scheduler still only schedules. The runtime device interprets events for a
specific device instance.

## Golden Device Checklist

Device:

- descriptor
- instance
- runtime
- factory
- registry

Playback:

- receives playback events
- handles automation
- handles transport
- handles parameter changes

Audio:

- polyphonic voices
- voice stealing
- ADSR
- portamento
- oscillator selection
- gain staging

Parameters:

- descriptor driven
- UI generated
- automatable
- smoothed
- serializable

Runtime:

- hot reconnect
- missing device behavior
- diagnostics
- latency reporting

## Voice Layer

The synth should not put voice behavior directly in the runtime device.

The runtime device should orchestrate reusable audio primitives:

```text
BasicSynthRuntimeDevice
  -> VoiceManager
  -> Voice
  -> Oscillator
  -> Envelope
  -> Filter
  -> AudioOutput
```

A likely package direction is:

```text
packages/audio/
  voices/
    Voice.ts
    VoiceManager.ts
    VoiceAllocator.ts
    ADSR.ts
    Glide.ts
```

The voice layer can later support samplers, hardware-backed devices, and native
runtime implementations without duplicating allocation and lifecycle behavior.

## Runtime Parameters

Descriptors explain what parameters exist. Runtime parameters explain how a
value behaves while the device is running.

The eventual shape should be:

```text
ParameterDescriptor
  -> ParameterInstance
  -> ParameterRuntime
```

Runtime parameter state can own:

- current value
- target value
- smoothed value
- automated value
- DSP value

This lets automation target a device parameter without the scheduler,
document, or UI needing to know how the device maps that value internally.

## Reference Behavior Tests

The golden device should introduce reference behavior tests for architecture,
not just UI smoke tests.

Examples:

- `NoteOn` allocates a voice
- `NoteOff` releases a voice
- voice stealing is deterministic
- automation changes a runtime parameter
- smoothed parameters approach their target values
- playback events reach only the targeted runtime device
- missing devices do not crash playback

These tests become regression coverage for the runtime architecture.

## Development Mode

Sequencer should now move from architecture-first development to reference
implementation mode.

The primary success question changes from:

```text
Did we introduce the right abstraction?
```

to:

```text
Did we make the golden device better?
```

The architecture is no longer the main product risk. The next risk is proving
that the architecture produces an instrument that feels immediate, reliable,
and expressive.
