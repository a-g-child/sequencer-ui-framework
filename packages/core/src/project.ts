import type { Entity } from "./entity";
import type { Relationship } from "./relationship";
import type { BeatTime, TimelineEvent } from "./events";
import type { ParameterOwner } from "./parameter-owner";
import type { SequencerDocument } from "./document";

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

export type SequencerProject = SequencerDocument;
