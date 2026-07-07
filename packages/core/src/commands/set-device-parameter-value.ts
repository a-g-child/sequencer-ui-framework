import type { DeviceParameterValue } from "@sequencer/device";
import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";

export class SetDeviceParameterValueCommand implements Command {
  readonly name = "Set Device Parameter Value";

  private previousValue: DeviceParameterValue = "";
  private hadPreviousValue = false;

  constructor(
    readonly deviceInstanceId: EntityId,
    readonly parameterKey: string,
    readonly nextValue: DeviceParameterValue
  ) {}

  execute(document: SequencerDocument): void {
    const device = document.deviceInstances.get(this.deviceInstanceId);

    this.hadPreviousValue = Object.hasOwn(
      device.parameterValues,
      this.parameterKey
    );
    this.previousValue = device.parameterValues[this.parameterKey];
    device.parameterValues[this.parameterKey] = this.nextValue;
  }

  undo(document: SequencerDocument): void {
    const device = document.deviceInstances.get(this.deviceInstanceId);

    if (this.hadPreviousValue) {
      device.parameterValues[this.parameterKey] = this.previousValue;
      return;
    }

    delete device.parameterValues[this.parameterKey];
  }
}

export { SetDeviceParameterValueCommand as SetDeviceParameterValueOperation };
