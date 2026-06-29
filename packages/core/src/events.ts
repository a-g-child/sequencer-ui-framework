import type { EntityId } from "./entity";
import type { Parameter, ParameterValue } from "./parameter";
import type { EntityRef } from "./reference";

export type EventType = "set" | "trigger" | "ramp";
export type BeatTime = number;

export type ParameterTarget = EntityRef<Parameter>;

export interface TimelineEvent<T extends ParameterValue = ParameterValue> {
  id: EntityId;
  time: BeatTime;
  duration?: BeatTime;
  target: ParameterTarget;
  type: EventType;
  value: T;
}
