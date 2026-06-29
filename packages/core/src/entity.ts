export type EntityId = string;

export interface Entity {
    id: EntityId;
    name: string;
}

export function createId(prefix: string): EntityId {
    return `${prefix}_${crypto.randomUUID()}`;
}