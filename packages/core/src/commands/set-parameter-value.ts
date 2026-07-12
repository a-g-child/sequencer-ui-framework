import type { Command } from "../command.ts";
import type { SequencerDocument } from "../document.ts";
import type { EntityId } from "../entity.ts";
import type { ParameterValue } from "../parameter.ts";

export class SetParameterValueCommand implements Command {
  readonly name = "Set Parameter Value";

  private previousValue?: ParameterValue;

  constructor(
    private readonly parameterId: EntityId,
    private readonly nextValue: ParameterValue
  ) {}

  execute(document: SequencerDocument): void {
    const parameter = document.parameters.get(this.parameterId);

    this.previousValue = parameter.value;
    parameter.value = this.nextValue;
  }

  undo(document: SequencerDocument): void {
    if (this.previousValue === undefined) return;

    const parameter = document.parameters.get(this.parameterId);
    parameter.value = this.previousValue;
  }
}

export { SetParameterValueCommand as SetParameterValueOperation };
