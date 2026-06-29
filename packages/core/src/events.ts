import type { EntityId } from "./entity";

export type EventType = "set" | "trigger" | "ramp";
export type BeatTime = number;

export interface TimelineEvent<T = unknown> {
  id: EntityId;
  time: BeatTime;
  duration?: BeatTime;
  target: string;
  type: EventType;
  value: T;
}