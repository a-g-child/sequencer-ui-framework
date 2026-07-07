# Audio Output

Audio is an output concern.

The current browser audio path is:

```text
Scheduler
  -> PlaybackEvents
  -> OutputManager
  -> WebAudioOutput
```

`WebAudioOutput` is a reference and proof output. It proves that scheduled
notes can travel through the playback pipeline and become audible sound without
adding audio logic to the scheduler, playback model, document model, or UI
editor state.

## WebAudioOutput

`WebAudioOutput` is browser-only.

It consumes `PlaybackEvent` batches through the `PlaybackOutput` interface:

- `note:on` creates a simple oscillator voice
- `note:off` releases and stops the voice
- note velocity maps to voice gain
- track enablement, waveform, output volume, and ADSR are live output settings

It is intentionally small. It is not the final audio engine.

Each track can opt into Web Audio independently. The browser still has one
`WebAudioOutput` instance behind the `OutputManager`, but voice creation checks
the event `trackId` and uses that track's oscillator settings.

The current envelope is intentionally simple:

- attack time
- decay time
- sustain level
- release time

ADSR belongs with voice execution, so it lives in `WebAudioOutput`. It is not
scheduler state.

## Ownership

The scheduler emits events.

The output owns voices.

The audio output may allocate oscillators, gains, voice maps, envelopes, DSP
nodes, drivers, or native resources. Those responsibilities must not move into
the scheduler.

```text
PlaybackEvents
  -> AudioOutput
  -> VoiceManager
  -> DSP
  -> Driver
```

In the current proof, `WebAudioOutput` contains the first tiny version of that
voice/output layer.

## Native Boundary

Future Rust or C++ audio should replace the audio output implementation, not the
scheduler or playback architecture.

The long-term contract stays the same:

```text
Scheduler emits PlaybackEvents
PlaybackOutput consumes PlaybackEvents
Audio output owns audio execution
```

That means a future native engine can implement the same output boundary while
the document, playback model builder, scheduler interface, transport, clock,
and UI architecture remain intact.

The broader native audio and scheduler integration strategy is described in
`docs/native-runtime.md`.

## Next Slice

The next musical step is routing automation events into output parameters such
as oscillator volume, pan, or envelope values.
