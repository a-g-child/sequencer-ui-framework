import type {
  MidiClip,
  Pattern,
  PatternPlacement,
  Track,
  TrackClipSlot
} from "./project.ts";
import { createDefaultTrackMixerState } from "./project.ts";
import type { AssetReference } from "@sequencer/assets";
import type { SequencerDocument } from "./document.ts";
import type { BeatTime } from "./events.ts";
import type { Timeline } from "./timeline.ts";
import { createId } from "./entity.ts";
import { Registry } from "./registry.ts";
import type { Parameter, ParameterDefinition } from "./parameter.ts";
import { addDefaultTrackParameters } from "./default-parameters.ts";
import {
  BASIC_SYNTH_DESCRIPTOR,
  type DeviceDescriptor,
  type DeviceInstance
} from "@sequencer/device";

export function createPattern(name = "Pattern A", length = 16): Pattern {
  return {
    id: createId("pattern"),
    name,
    length,
    events: []
  };
}

export function createMidiClip(
  pattern: Pattern["id"],
  name = "Clip",
  length = 16,
  loopEnabled = true,
  loopStart = 0,
  loopLength = length
): MidiClip {
  return {
    id: createId("clip"),
    name,
    pattern,
    length,
    loopEnabled,
    loopStart,
    loopLength
  };
}

export function createTrack(
  name = "Track 1",
  target?: string,
  deviceId?: DeviceInstance["id"]
): Track {
  return {
    id: createId("track"),
    name,
    clips: [],
    placements: [],
    mixer: createDefaultTrackMixerState(),
    parameters: [],
    deviceId,
    target
  };
}

export function createDeviceInstance(
  descriptor: DeviceDescriptor,
  name = descriptor.name
): DeviceInstance {
  return {
    id: createId("device"),
    descriptorKey: descriptor.key,
    name,
    parameterValues: Object.fromEntries(
      descriptor.parameters.map((parameter) => [
        parameter.key,
        parameter.defaultValue
      ])
    )
  };
}

export function createTrackClipSlot(
  source: Track["id"],
  target: MidiClip["id"],
  slotIndex: number,
  name = `Slot ${slotIndex + 1}`
): TrackClipSlot {
  return {
    id: createId("clip_slot"),
    name,
    source,
    target,
    slotIndex
  };
}

export function createPatternPlacement(
  source: Track["id"],
  target: Pattern["id"],
  start: BeatTime,
  length?: BeatTime,
  loop = true,
  loopStart?: BeatTime,
  loopLength?: BeatTime,
  loopCount?: number
): PatternPlacement {
  return {
    id: createId("placement"),
    name: "Pattern Placement",
    source,
    target,
    start,
    length,
    loop,
    loopStart,
    loopLength,
    loopCount
  };
}

export function createTimeline(length = 16): Timeline {
  return {
    length,
    markers: []
  };
}

export function createDocument(name = "Sequencer"): SequencerDocument {
  const pattern = createPattern();
  const midiClip = createMidiClip(pattern.id, "Clip 1", pattern.length);
  const deviceInstance = createDeviceInstance(BASIC_SYNTH_DESCRIPTOR);
  const track = createTrack("Track 1", undefined, deviceInstance.id);
  const patterns = new Registry<Pattern>();
  const midiClips = new Registry<MidiClip>();
  const tracks = new Registry<Track>();
  const assets = new Registry<AssetReference>();
  const deviceInstances = new Registry<DeviceInstance>();
  const timeline = createTimeline();

  track.clips.push(createTrackClipSlot(track.id, midiClip.id, 0, midiClip.name));
  track.placements.push(
    createPatternPlacement(track.id, pattern.id, 0, pattern.length)
  );
  midiClips.add(midiClip);
  patterns.add(pattern);
  deviceInstances.add(deviceInstance);
  tracks.add(track);

  const document: SequencerDocument = {
    id: createId("document"),
    name,
    bpm: 120,
    timeline,
    assets,
    tracks,
    deviceInstances,
    midiClips,
    patterns,
    parameterDefinitions: new Registry<ParameterDefinition>(),
    parameters: new Registry<Parameter>()
  };

  addDefaultTrackParameters(document, track);

  return document;
}

export function createProject(name = "Sequencer"): SequencerDocument {
  return createDocument(name);
}
