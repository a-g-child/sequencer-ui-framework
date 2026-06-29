import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { Entity } from "../entity";
import type { Registry } from "../registry";

export class RenameEntityCommand<T extends Entity> implements Command {
  readonly name = "Rename Entity";

  private previousName?: string;

  constructor(
    private readonly registry: Registry<T>,
    private readonly entityId: string,
    private readonly nextName: string
  ) {}

  execute(_document: SequencerDocument): void {
    const entity = this.registry.get(this.entityId);

    this.previousName = entity.name;
    entity.name = this.nextName;
  }

  undo(_document: SequencerDocument): void {
    if (this.previousName === undefined) return;

    const entity = this.registry.get(this.entityId);
    entity.name = this.previousName;
  }
}
