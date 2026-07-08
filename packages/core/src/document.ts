import type { Entity } from "./entity";
import type { AssetReference } from "@sequencer/assets";
import type { DeviceInstance } from "@sequencer/device";
import type { Parameter, ParameterDefinition } from "./parameter";
import type { MidiClip, Pattern, Track } from "./project";
import type { Registry } from "./registry";
import type { Timeline } from "./timeline";

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
