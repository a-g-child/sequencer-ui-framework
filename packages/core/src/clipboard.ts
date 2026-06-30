import type { Entity } from "./entity";

export class ClipboardModel {
  private items: Entity[] = [];
  private payload: unknown;

  set(items: Entity[]): void {
    this.items = [...items];
    this.payload = undefined;
  }

  values(): Entity[] {
    return [...this.items];
  }

  hasItems(): boolean {
    return this.items.length > 0;
  }

  setPayload(payload: unknown): void {
    this.payload = payload;
    this.items = [];
  }

  getPayload<T = unknown>(): T | undefined {
    return this.payload as T | undefined;
  }

  hasPayload(): boolean {
    return this.payload !== undefined;
  }

  clear(): void {
    this.items = [];
    this.payload = undefined;
  }
}
