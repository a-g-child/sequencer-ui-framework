import { SAMPLER_DESCRIPTOR } from '../descriptors/sampler.ts';
import type { DeviceFactory } from '../factory.ts';
import type { DeviceInstance } from '../instance.ts';
import {
  createRuntimeParameters,
  getRuntimeParameterEffectiveValue,
  getRuntimeParameter,
  setRuntimeParameterValue
} from '../parameter-runtime.ts';
import { BaseRuntimeDevice } from '../runtime.ts';
import type { SampleSlot, SamplerMode } from '../sampler.ts';

export type SamplerDeviceInstance = DeviceInstance & {
  descriptorKey: 'sampler';
  sampleSlots?: SampleSlot[];
};

export type SamplerDiagnostics = {
  readonly triggeredSamples: number;
  readonly missingSamples: number;
  readonly lastTriggeredSlot?: string;
};

export class SamplerRuntimeDevice<
  TEvent = unknown
> extends BaseRuntimeDevice<TEvent> {
  private triggeredSamples = 0;
  private missingSamples = 0;
  private lastTriggeredSlot?: string;

  constructor(
    instance: DeviceInstance,
    parameters = createRuntimeParameters(SAMPLER_DESCRIPTOR, instance)
  ) {
    super(instance, parameters);
  }

  get sampleSlots(): readonly SampleSlot[] {
    return isSamplerDeviceInstance(this.instance)
      ? this.instance.sampleSlots ?? []
      : [];
  }

  get mode(): SamplerMode {
    const value = getRuntimeParameterEffectiveValue(this.parameters, 'mode');

    return value === 'multi' ? 'multi' : 'pitched';
  }

  processEvents(events: readonly TEvent[]): void {
    for (const event of events) {
      if (isNoteOnEvent(event)) {
        this.triggerSampleForNote(event.pitch);
        continue;
      }

      if (isNoteOffEvent(event)) {
        continue;
      }

      if (!isParameterEvent(event)) continue;

      const parameter = getRuntimeParameter(this.parameters, event.parameterKey);

      if (parameter) {
        setRuntimeParameterValue(parameter, event.value);
      }
    }
  }

  resolveSlotForNote(pitch: number): SampleSlot | undefined {
    const slots = this.sampleSlots;

    if (slots.length === 0 || !Number.isFinite(pitch)) {
      return undefined;
    }

    if (this.mode === 'multi') {
      return slots.find((slot) => slot.rootNote === pitch);
    }

    return [...slots].sort(
      (left, right) =>
        Math.abs(left.rootNote - pitch) - Math.abs(right.rootNote - pitch)
    )[0];
  }

  getDiagnostics(): SamplerDiagnostics {
    return {
      triggeredSamples: this.triggeredSamples,
      missingSamples: this.missingSamples,
      lastTriggeredSlot: this.lastTriggeredSlot
    };
  }

  private triggerSampleForNote(pitch: number): void {
    const slot = this.resolveSlotForNote(pitch);
    this.lastTriggeredSlot = slot?.id;

    if (!slot?.assetId) {
      this.missingSamples += 1;
      return;
    }

    this.triggeredSamples += 1;
  }
}

export class SamplerFactory<TEvent = unknown>
  implements DeviceFactory<TEvent>
{
  readonly descriptor = SAMPLER_DESCRIPTOR;

  create(instance: DeviceInstance): SamplerRuntimeDevice<TEvent> {
    return new SamplerRuntimeDevice(
      instance,
      createRuntimeParameters(this.descriptor, instance)
    );
  }
}

function isSamplerDeviceInstance(
  instance: DeviceInstance
): instance is SamplerDeviceInstance {
  return instance.descriptorKey === SAMPLER_DESCRIPTOR.key;
}

function isParameterEvent(
  event: unknown
): event is { readonly parameterKey: string; readonly value: number | string } {
  return (
    typeof event === 'object' &&
    event !== null &&
    'parameterKey' in event &&
    'value' in event &&
    typeof event.parameterKey === 'string' &&
    (typeof event.value === 'number' || typeof event.value === 'string')
  );
}

function isNoteOnEvent(event: unknown): event is {
  readonly type: 'note:on';
  readonly pitch: number;
} {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    event.type === 'note:on' &&
    'pitch' in event &&
    typeof event.pitch === 'number'
  );
}

function isNoteOffEvent(event: unknown): event is {
  readonly type: 'note:off';
} {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    event.type === 'note:off'
  );
}
