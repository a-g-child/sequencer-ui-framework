import type { EntityId } from "./entity.ts";

export interface SelectionItem {
  type: string;
  id: EntityId;
  parentId?: EntityId;
  ids?: EntityId[];
}

export class SelectionModel {
  private readonly items = new Map<string, SelectionItem>();

  set(items: SelectionItem[]): void {
    this.items.clear();

    for (const item of items) {
      this.items.set(this.createKey(item), item);
    }
  }

  add(item: SelectionItem): void {
    this.items.set(this.createKey(item), item);
  }

  remove(item: SelectionItem): boolean {
    return this.items.delete(this.createKey(item));
  }

  has(item: SelectionItem): boolean {
    return this.items.has(this.createKey(item));
  }

  values(): SelectionItem[] {
    return [...this.items.values()];
  }

  current(): SelectionItem | undefined {
    return this.values()[0];
  }

  clear(): void {
    this.items.clear();
  }

  private createKey(item: SelectionItem): string {
    return `${item.type}:${item.parentId ?? ""}:${item.id}`;
  }
}
