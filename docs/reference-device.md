# Reference Device

The Basic Synth Runtime Device exists to demonstrate the complete
`RuntimeDevice` architecture.

It is not meant to be the flagship instrument. It is the golden device: the
smallest complete implementation that proves the framework can become a
fantastic playable instrument.

Future devices should look here before inventing new patterns.

The north star is:

```text
The Golden Device is the reference implementation of the RuntimeDevice
architecture.
```

Every design decision should survive this question:

```text
Would the Golden Device need a special case for this?
```

If the answer is yes, the architecture probably needs another look.

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

The living checklist lives in `docs/golden-device-checklist.md`.

It should become the daily acceptance test for the runtime architecture.

The checklist is more important than the broad roadmap during Golden Device
work. If a task does not improve the golden device, it should wait unless it
removes a real blocker.

## Recurring Runtime Pattern

Sequencer now has a repeated runtime shape:

```text
Descriptor
  -> Instance
  -> Runtime
  -> Execution
```

Examples:

```text
DeviceDescriptor
  -> DeviceInstance
  -> RuntimeDevice
  -> Output

ParameterDescriptor
  -> ParameterInstance
  -> RuntimeParameter
  -> DSP

VoiceDefinition
  -> VoiceAllocation
  -> RuntimeVoice
  -> Oscillator

Document
  -> PlaybackModel
  -> Scheduler
  -> PlaybackEvents
```

This pattern is healthy. New runtime concepts should try to fit it before
creating special cases.

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

The first voice slice should stay audio-engine independent:

```text
note:on
  -> allocate voice

note:off
  -> release voice

max polyphony reached
  -> steal oldest active voice
```

This proves voice lifecycle before tying allocation to Web Audio, native audio,
or DSP.

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
- default value
- smoothed value
- automated value
- DSP value

This lets automation target a device parameter without the scheduler,
document, or UI needing to know how the device maps that value internally.

Parameters are likely to be the hardest and most important part of the golden
device. Automation, smoothing, modulation, UI editing, MIDI learn, hardware
encoders, snapshots, and clip automation all become parameter behavior.

The first runtime parameter slice should stay intentionally small:

```text
DeviceDescriptor default
  + DeviceInstance override
  -> RuntimeParameter current / target / default / smoothed-ready value
  -> RuntimeDevice
```

Smoothing fields may exist before smoothing behavior. The important milestone is
that the runtime device reads parameter state from one place.

The smoothing utility belongs in `@sequencer/device`, not inside a synth. Numeric
parameters move from current value toward target value over time. Boolean,
choice, and text parameters snap to their target values immediately.

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
