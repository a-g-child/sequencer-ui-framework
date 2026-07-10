import type { DeviceDescriptor } from './descriptor.ts';
import type { DeviceInstance } from './instance.ts';
import type { RuntimeDevice } from './runtime.ts';

export interface DeviceFactory<TEvent = unknown> {
  readonly descriptor: DeviceDescriptor;

  create(instance: DeviceInstance): RuntimeDevice<TEvent>;
}
