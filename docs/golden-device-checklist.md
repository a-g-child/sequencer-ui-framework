# Golden Device Checklist

The Golden Device checklist is the day-to-day acceptance test for the
architecture.

The project has moved from architecture-first development to reference
implementation mode. The main question is now:

```text
Did we make the golden device better?
```

## North Star

The Golden Device is the reference implementation of the `RuntimeDevice`
architecture.

Every design decision should survive this question:

```text
Would the Golden Device need a special case for this?
```

If the answer is yes, the architecture probably needs another look.

## Playback

- [x] receives playback events through `PlaybackDeviceManager`
- [x] events carry `PlaybackEvent.destination.deviceInstanceId`
- [x] live clip launching feeds playback events
- [x] automation events exist in playback
- [ ] parameter automation is bound to runtime parameters
- [ ] tempo sync reaches runtime device behavior
- [ ] transport events reach runtime device behavior

## Device

- [x] descriptor
- [x] instance
- [x] runtime
- [x] factory
- [x] registry
- [x] missing runtime device fallback
- [ ] hot reconnect behavior
- [ ] latency reporting

## Voices

- [ ] voice manager
- [ ] voice allocator
- [ ] voice stealing
- [ ] mono mode
- [ ] poly mode
- [ ] glide
- [ ] deterministic release behavior

## Oscillators

- [ ] sine
- [ ] saw
- [ ] square
- [ ] triangle
- [ ] noise
- [ ] PWM

Oscillator quality is not the current risk. A rough oscillator is acceptable if
it uses the correct runtime architecture.

## Envelope

- [ ] ADSR
- [ ] velocity sensitivity
- [ ] retrigger modes

## Filter

- [ ] low-pass
- [ ] high-pass
- [ ] band-pass
- [ ] resonance
- [ ] key tracking

## Parameters

- [x] descriptor vocabulary
- [x] document-owned parameter values on device instances
- [ ] runtime values
- [ ] current value
- [ ] target value
- [ ] smoothed value
- [ ] automated value
- [ ] DSP value
- [ ] descriptor-driven inspector
- [ ] automation binding
- [ ] modulation
- [ ] serialization round trip for runtime-relevant values

Parameters are likely to become as important as runtime devices. Automation,
UI editing, MIDI learn, hardware encoders, parameter snapshots, and clip
automation all converge here.

## Diagnostics

- [ ] voice count
- [ ] CPU usage
- [ ] clipping
- [ ] peak meter
- [ ] latency
- [ ] runtime device status in UI
- [ ] missing device status in UI

## Runtime

- [x] runtime device abstraction
- [x] playback-side runtime device adapter
- [x] playback events routed to runtime devices
- [ ] runtime state reporting
- [ ] hot reconnect
- [ ] replace software implementation with hardware implementation
- [ ] duplicate device and swap implementation without changing clips
- [ ] same automation works across equivalent implementations

## Reference Tests

- [ ] `NoteOn` allocates a voice
- [ ] `NoteOff` releases a voice
- [ ] voice stealing is deterministic
- [ ] parameter automation changes a runtime parameter
- [ ] smoothed parameters approach target values
- [ ] playback events reach only the targeted runtime device
- [ ] missing devices do not crash playback
- [ ] outputs still receive diagnostic event batches
