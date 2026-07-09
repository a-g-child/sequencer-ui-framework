# Mixer

Mixer v1 is track intent, not audio analysis.

Each track owns a first-class mixer state:

```ts
type TrackMixerState = {
  volume: number; // 0..1
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
};
```

This state is part of the creative document and is serialized with the project.
It is not a Web Audio implementation detail.

## Runtime Path

```text
Track.mixer
  -> PlaybackModelBuilder
  -> PlaybackTrack.mixer
  -> PlaybackEvent.mixer
  -> WebAudioOutput track mix stage
```

Web Audio applies mixer state through per-track gain and pan nodes after the
device voice/sample gain stage. This keeps synth envelopes, sampler gain, and
track mixing separate.

## Solo And Mute

Solo logic is central:

```text
if any track is soloed:
  only soloed tracks are audible
else:
  muted tracks are silent
```

Mute still silences a soloed track. In other words, solo selects the audible
set, and mute can silence a member of that set.

## Current Scope

Mixer v1 includes:

- track volume
- track pan
- track mute
- track solo
- serialization and load backfill
- selected-track UI controls
- Web Audio gain/pan application

Mixer v1 deliberately does not include meters. Level display requires runtime
audio analysis and should be added after routing and mix behavior stay stable.
