import type { DeviceInstance } from "@sequencer/device";
import type { Command } from "../command";
import type { SequencerDocument } from "../document";

export class AddDeviceInstanceCommand implements Command {
  readonly name = "Add Device Instance";

  private replacedDevice?: DeviceInstance;

  constructor(readonly device: DeviceInstance) {}

  execute(document: SequencerDocument): void {
    this.replacedDevice = document.deviceInstances.find(this.device.id);
    document.deviceInstances.add(this.device);
  }

  undo(document: SequencerDocument): void {
    if (this.replacedDevice) {
      document.deviceInstances.add(this.replacedDevice);
      return;
    }

    document.deviceInstances.remove(this.device.id);
  }
}

export { AddDeviceInstanceCommand as AddDeviceInstanceOperation };
