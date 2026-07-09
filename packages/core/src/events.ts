import type { EntityId } from "./entity.ts";
import type { Parameter } from "./parameter.ts";
import type { EntityRef } from "./reference.ts";

export type EventType = "set" | "trigger" | "ramp";
export type BeatTime = number;

export type ParameterTarget = EntityRef<Parameter>;

export interface TimelineEvent<T = unknown> {
  id: EntityId;
  time: BeatTime;
  duration?: BeatTime;
  target?: ParameterTarget;
  type: EventType;
  value: T;
}
