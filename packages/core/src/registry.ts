import type { Entity, EntityId } from "./entity.ts";

export class Registry<T extends Entity> {
  private readonly entities = new Map<EntityId, T>();

  add(entity: T): void {
    this.entities.set(entity.id, entity);
  }

  remove(id: EntityId): boolean {
    return this.entities.delete(id);
  }

  find(id: EntityId): T | undefined {
    return this.entities.get(id);
  }

  get(id: EntityId): T {
    const entity = this.find(id);

    if (!entity) {
      throw new Error(`Entity not found: ${id}`);
    }

    return entity;
  }

  findByKey(key: string): T | undefined {
    return this.values().find((entity) => entity.key === key);
  }

  getByKey(key: string): T {
    const entity = this.findByKey(key);

    if (!entity) {
      throw new Error(`Entity not found by key: ${key}`);
    }

    return entity;
  }

  values(): T[] {
    return [...this.entities.values()];
  }

  has(id: EntityId): boolean {
    return this.entities.has(id);
  }

  clear(): void {
    this.entities.clear();
  }
}
