import type { Entity } from "./entity";
import type { Relationship } from "./relationship";
import type { BeatTime, TimelineEvent } from "./events";
import type { Registry } from "./registry";
import type { Timeline } from "./timeline";
import type { Parameter, ParameterDefinition } from "./parameter";
import type { ParameterOwner } from "./parameter-owner";

export interface Pattern extends Entity {
  length: BeatTime;
  events: TimelineEvent[];
}

export interface Track extends Entity, ParameterOwner {
  placements: PatternPlacement[];
  target?: string;
}

export interface PatternPlacement extends Relationship<Track, Pattern> {
  start: BeatTime;
  length?: BeatTime;
  loopCount?: number;
}

export interface SequencerProject extends Entity {
  bpm: number;
  timeline: Timeline;
  tracks: Registry<Track>;
  patterns: Registry<Pattern>;
  parameterDefinitions: Registry<ParameterDefinition>;
  parameters: Registry<Parameter>;
}
