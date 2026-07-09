import type { Entity } from "./entity.ts";
import type { BeatTime } from "./events.ts";

export interface TimelineMarker extends Entity {
  time: BeatTime;
}

export interface Timeline {
  length: BeatTime;
  markers: TimelineMarker[];
}
