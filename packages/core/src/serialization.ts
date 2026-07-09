import { Registry } from "./registry.ts";
import type { SequencerDocument } from "./document.ts";
import type { MidiClip, Pattern, Track } from "./project.ts";
import type { Parameter, ParameterDefinition } from "./parameter.ts";
import type { Timeline } from "./timeline.ts";
import type { AssetReference } from "@sequencer/assets";
import type { DeviceInstance } from "@sequencer/device";

interface SerializedDocument {
  id: SequencerDocument["id"];
  name: string;
  bpm: number;
  timeline: Timeline;
  assets?: AssetReference[];
  tracks: Track[];
  deviceInstances?: DeviceInstance[];
  midiClips?: MidiClip[];
  patterns: Pattern[];
  parameterDefinitions: ParameterDefinition[];
  parameters: Parameter[];
}

export function serializeDocument(document: SequencerDocument): string {
  const serialized: SerializedDocument = {
    id: document.id,
    name: document.name,
    bpm: document.bpm,
    timeline: document.timeline,
    assets: document.assets.values(),
    tracks: document.tracks.values(),
    deviceInstances: document.deviceInstances.values(),
    midiClips: document.midiClips.values(),
    patterns: document.patterns.values(),
    parameterDefinitions: document.parameterDefinitions.values(),
    parameters: document.parameters.values()
  };

  return JSON.stringify(serialized, null, 2);
}

export function deserializeDocument(json: string): SequencerDocument {
  const serialized = JSON.parse(json) as SerializedDocument;
  const tracks = new Registry<Track>();
  const assets = new Registry<AssetReference>();
  const deviceInstances = new Registry<DeviceInstance>();
  const midiClips = new Registry<MidiClip>();
  const patterns = new Registry<Pattern>();
  const parameterDefinitions = new Registry<ParameterDefinition>();
  const parameters = new Registry<Parameter>();

  for (const pattern of serialized.patterns) {
    patterns.add(pattern);
  }

  for (const asset of serialized.assets ?? []) {
    assets.add(asset);
  }

  for (const track of serialized.tracks) {
    track.clips ??= [];
    tracks.add(track);
  }

  for (const deviceInstance of serialized.deviceInstances ?? []) {
    deviceInstances.add(deviceInstance);
  }

  for (const clip of serialized.midiClips ?? []) {
    midiClips.add(clip);
  }

  for (const definition of serialized.parameterDefinitions ?? []) {
    parameterDefinitions.add(definition);
  }

  for (const parameter of serialized.parameters ?? []) {
    parameters.add(parameter);
  }

  return {
    id: serialized.id,
    name: serialized.name,
    bpm: serialized.bpm,
    timeline: serialized.timeline,
    assets,
    tracks,
    deviceInstances,
    midiClips,
    patterns,
    parameterDefinitions,
    parameters
  };
}

export function serializeProject(project: SequencerDocument): string {
  return serializeDocument(project);
}

export function deserializeProject(json: string): SequencerDocument {
  return deserializeDocument(json);
}
