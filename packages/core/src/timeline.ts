import type { Entity } from "./entity";
import type { BeatTime } from "./events";

export interface TimelineMarker extends Entity {
  time: BeatTime;
}

export interface Timeline {
  length: BeatTime;
  markers: TimelineMarker[];
}