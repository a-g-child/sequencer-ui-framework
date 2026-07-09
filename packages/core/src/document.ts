import type { Entity } from "./entity.ts";
import type { AssetReference } from "@sequencer/assets";
import type { DeviceInstance } from "@sequencer/device";
import type { Parameter, ParameterDefinition } from "./parameter.ts";
import type { MidiClip, Pattern, Track } from "./project.ts";
import type { Registry } from "./registry.ts";
import type { Timeline } from "./timeline.ts";

export interface SequencerDocument extends Entity {
  bpm: number;
  timeline: Timeline;
  assets: Registry<AssetReference>;
  tracks: Registry<Track>;
  deviceInstances: Registry<DeviceInstance>;
  midiClips: Registry<MidiClip>;
  patterns: Registry<Pattern>;
  parameterDefinitions: Registry<ParameterDefinition>;
  parameters: Registry<Parameter>;
}
