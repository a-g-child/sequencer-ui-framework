import type { Entity } from "./entity";

export class ClipboardModel {
  private items: Entity[] = [];

  set(items: Entity[]): void {
    this.items = [...items];
  }

  values(): Entity[] {
    return [...this.items];
  }

  hasItems(): boolean {
    return this.items.length > 0;
  }

  clear(): void {
    this.items = [];
  }
}
