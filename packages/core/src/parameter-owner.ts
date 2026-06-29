import type { Entity } from "./entity";
import type { Parameter } from "./parameter";
import type { EntityRef } from "./reference";

export interface ParameterOwner extends Entity {
  parameters: EntityRef<Parameter>[];
}

export function ownsParameters(entity: Entity): entity is ParameterOwner {
  return Array.isArray((entity as ParameterOwner).parameters);
}
