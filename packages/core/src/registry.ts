import type { Entity, EntityId } from "./entity";

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