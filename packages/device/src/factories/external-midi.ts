import { EXTERNAL_MIDI_DESCRIPTOR } from '../descriptors/external-midi';
import type { DeviceFactory } from '../factory';
import type { DeviceInstance } from '../instance';
import { createRuntimeParameters } from '../parameter-runtime';
import { BaseRuntimeDevice } from '../runtime';

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
