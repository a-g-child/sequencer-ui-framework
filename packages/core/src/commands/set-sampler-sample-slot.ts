import type { SampleSlot, SamplerDeviceInstance } from "@sequencer/device";
import type { Command } from "../command";
import type { SequencerDocument } from "../document";
import type { EntityId } from "../entity";

export class SetSamplerSampleSlotCommand implements Command {
  readonly name = "Set Sampler Sample Slot";

  private previousSlots?: SampleSlot[];

  constructor(
    readonly deviceInstanceId: EntityId,
    readonly slot: SampleSlot
  ) {}

  execute(document: SequencerDocument): void {
    const device = document.deviceInstances.get(
      this.deviceInstanceId
    ) as SamplerDeviceInstance;
    const slots = device.sampleSlots ?? [];
    const existingIndex = slots.findIndex((slot) => slot.id === this.slot.id);

    this.previousSlots = slots.map((slot) => ({ ...slot }));

    if (existingIndex >= 0) {
      device.sampleSlots = slots.map((slot, index) =>
        index === existingIndex ? { ...this.slot } : slot
      );
      return;
    }

    device.sampleSlots = [...slots, { ...this.slot }];
  }

  undo(document: SequencerDocument): void {
    const device = document.deviceInstances.get(
      this.deviceInstanceId
    ) as SamplerDeviceInstance;

    device.sampleSlots = this.previousSlots?.map((slot) => ({ ...slot }));
  }
}

export { SetSamplerSampleSlotCommand as SetSamplerSampleSlotOperation };
