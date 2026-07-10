# Native Audio Engine

This workspace is the split-ready real-time execution side of Sequencer.

It owns execution-specific responsibilities:

- audio-device lifecycle
- authoritative sample clock
- real-time scheduler
- command and telemetry queues
- native execution plan loading
- DSP node implementations
- buffer allocation
- voice pools
- parameter smoothing
- plan swapping
- meters and diagnostics

It must not depend on Svelte, Node, Electron, the Sequencer document model, or
UI concepts.

The first implementation target is intentionally small:

```text
headless host
  -> audio driver abstraction
  -> silence-writing engine core
  -> monotonic sample counter
  -> callback telemetry
```

The initial `engine-audio-io` driver is a deterministic null driver so the
engine can be tested without an audio device. A CPAL-backed driver should be
added behind the same `AudioDriver` trait next.
