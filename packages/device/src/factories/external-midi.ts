import { EXTERNAL_MIDI_DESCRIPTOR } from '../descriptors/external-midi.ts';
import type { DeviceFactory } from '../factory.ts';
import type { DeviceInstance } from '../instance.ts';
import { createRuntimeParameters } from '../parameter-runtime.ts';
import { BaseRuntimeDevice } from '../runtime.ts';

export class ExternalMidiRuntimeDevice<
  TEvent = unknown
> extends BaseRuntimeDevice<TEvent> {}

export class ExternalMidiFactory<TEvent = unknown>
  implements DeviceFactory<TEvent>
{
  readonly descriptor = EXTERNAL_MIDI_DESCRIPTOR;

  create(instance: DeviceInstance): ExternalMidiRuntimeDevice<TEvent> {
    return new ExternalMidiRuntimeDevice(
      instance,
      createRuntimeParameters(this.descriptor, instance)
    );
  }
}
