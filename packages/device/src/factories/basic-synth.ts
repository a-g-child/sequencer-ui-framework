import { BASIC_SYNTH_DESCRIPTOR } from '../descriptors/basic-synth';
import type { DeviceFactory } from '../factory';
import type { DeviceInstance } from '../instance';
import {
  advanceRuntimeParameters,
  createRuntimeParameters,
  getRuntimeParameter,
  getRuntimeParameterValue,
  setRuntimeParameterValue
} from '../parameter-runtime';
import { BaseRuntimeDevice } from '../runtime';

export class BasicSynthRuntimeDevice<
  TEvent = unknown
> extends BaseRuntimeDevice<TEvent> {
  get waveform(): string {
    const value = getRuntimeParameterValue(this.parameters, 'waveform');

    return typeof value === 'string' ? value : 'sine';
  }

  get volume(): number {
    const value = getRuntimeParameterValue(this.parameters, 'volume');

    return typeof value === 'number' ? value : 0.25;
  }

  processEvents(events: readonly TEvent[]): void {
    for (const event of events) {
      if (!isParameterEvent(event)) continue;

      const parameter = getRuntimeParameter(this.parameters, event.parameterKey);

      if (parameter) {
        setRuntimeParameterValue(parameter, event.value);
      }
    }
  }

  advance(deltaMs: number): void {
    advanceRuntimeParameters(this.parameters, deltaMs);
  }
}

export class BasicSynthFactory<TEvent = unknown>
  implements DeviceFactory<TEvent>
{
  readonly descriptor = BASIC_SYNTH_DESCRIPTOR;

  create(instance: DeviceInstance): BasicSynthRuntimeDevice<TEvent> {
    return new BasicSynthRuntimeDevice(
      instance,
      createRuntimeParameters(this.descriptor, instance)
    );
  }
}

function isParameterEvent(
  event: unknown
): event is { readonly parameterKey: string; readonly value: number } {
  return (
    typeof event === 'object' &&
    event !== null &&
    'parameterKey' in event &&
    'value' in event &&
    typeof event.parameterKey === 'string' &&
    typeof event.value === 'number'
  );
}
