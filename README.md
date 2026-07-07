# Sequencer

Sequencer is a creative runtime for musical instruments, editors, and future
hardware. Its first focused product direction is a groovebox: live clip
launching, tracks, devices, automation, and hands-on performance.

The project is organized around creative intent rather than a single playback
implementation. Documents describe what the creator intended. Devices realize
that intent. Playback decides when it happens. Runtime systems can change
without changing the creative document.

## Onboarding Path

Read the project in this order:

1. [Musical Computer Vision](docs/groovebox-vision.md)
2. [Principles](docs/principles.md)
3. [Framework](docs/framework.md)
4. [Playback](docs/playback.md)
5. [Device Model](docs/device-model.md)
6. [Reference Device](docs/reference-device.md)
7. [Golden Device Checklist](docs/golden-device-checklist.md)

## Current North Star

The Golden Device is the reference implementation of the `RuntimeDevice`
architecture.

Every design decision should survive one question:

```text
Would the Golden Device need a special case for this?
```

If the answer is yes, the architecture probably needs another look.

## Runtime Shape

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

The scheduler schedules. Runtime devices execute creative device behavior.
Outputs provide final I/O, diagnostics, and fallback execution paths.
