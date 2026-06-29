import type { Entity, EntityId } from "./entity";
import type { EntityRef } from "./reference";

export interface Relationship<
  TSource extends Entity = Entity,
  TTarget extends Entity = Entity
> extends Entity {
  source: EntityRef<TSource>;
  target: EntityRef<TTarget>;
}

export function createRelationshipId(prefix = "rel"): EntityId {
  return `${prefix}_${crypto.randomUUID()}`;
}