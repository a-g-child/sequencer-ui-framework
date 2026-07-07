import { BASIC_SYNTH_DESCRIPTOR } from '../descriptors/basic-synth';
import type { DeviceFactory } from '../factory';
import type { DeviceInstance } from '../instance';
import { BaseRuntimeDevice } from '../runtime';

export class BasicSynthRuntimeDevice<
  TEvent = unknown
> extends BaseRuntimeDevice<TEvent> {}

export class BasicSynthFactory<TEvent = unknown>
  implements DeviceFactory<TEvent>
{
  readonly descriptor = BASIC_SYNTH_DESCRIPTOR;

  create(instance: DeviceInstance): BasicSynthRuntimeDevice<TEvent> {
    return new BasicSynthRuntimeDevice(instance);
  }
}
