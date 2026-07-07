import type { DeviceDescriptor } from './descriptor';
import type { DeviceInstance } from './instance';
import type { RuntimeDevice } from './runtime';

export interface DeviceFactory<TEvent = unknown> {
  readonly descriptor: DeviceDescriptor;

  create(instance: DeviceInstance): RuntimeDevice<TEvent>;
}
