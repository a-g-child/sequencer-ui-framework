import type { EntityId } from "./entity";

export class SelectionModel {
  private readonly ids = new Set<EntityId>();

  set(ids: EntityId[]): void {
    this.ids.clear();

    for (const id of ids) {
      this.ids.add(id);
    }
  }

  add(id: EntityId): void {
    this.ids.add(id);
  }

  remove(id: EntityId): boolean {
    return this.ids.delete(id);
  }

  has(id: EntityId): boolean {
    return this.ids.has(id);
  }

  values(): EntityId[] {
    return [...this.ids.values()];
  }

  clear(): void {
    this.ids.clear();
  }
}
