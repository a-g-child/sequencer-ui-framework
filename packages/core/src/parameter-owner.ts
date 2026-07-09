import type { Entity } from "./entity.ts";
import type { Parameter } from "./parameter.ts";
import type { EntityRef } from "./reference.ts";

export interface ParameterOwner extends Entity {
  parameters: EntityRef<Parameter>[];
}

export function ownsParameters(entity: Entity): entity is ParameterOwner {
  return Array.isArray((entity as ParameterOwner).parameters);
}
