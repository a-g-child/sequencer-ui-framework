import type { Entity } from "./entity";
import type { Parameter, ParameterDefinition } from "./parameter";
import type { Pattern, Track } from "./project";
import type { Registry } from "./registry";
import type { Timeline } from "./timeline";

export interface SequencerDocument extends Entity {
  bpm: number;
  timeline: Timeline;
  tracks: Registry<Track>;
  patterns: Registry<Pattern>;
  parameterDefinitions: Registry<ParameterDefinition>;
  parameters: Registry<Parameter>;
}
