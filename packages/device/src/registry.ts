import type { DeviceDescriptor } from './descriptor';
import type { DeviceFactory } from './factory';
import type { DeviceId, DeviceInstance } from './instance';
import { MissingRuntimeDevice, type RuntimeDevice } from './runtime';

export class DeviceRegistry<TEvent = unknown> {
  private readonly factoriesByDescriptorKey = new Map<
    string,
    DeviceFactory<TEvent>
  >();

  register(factory: DeviceFactory<TEvent>): DeviceFactory<TEvent> {
    this.factoriesByDescriptorKey.set(factory.descriptor.key, factory);
    return factory;
  }

  remove(descriptorKey: string): DeviceFactory<TEvent> | undefined {
    const factory = this.factoriesByDescriptorKey.get(descriptorKey);
    this.factoriesByDescriptorKey.delete(descriptorKey);
    return factory;
  }

  findFactory(descriptorKey: string): DeviceFactory<TEvent> | undefined {
    return this.factoriesByDescriptorKey.get(descriptorKey);
  }

  getFactory(descriptorKey: string): DeviceFactory<TEvent> {
    const factory = this.findFactory(descriptorKey);

    if (!factory) {
      throw new Error(`Device factory not found: ${descriptorKey}`);
    }

    return factory;
  }

  hasFactory(descriptorKey: string): boolean {
    return this.factoriesByDescriptorKey.has(descriptorKey);
  }

  descriptors(): DeviceDescriptor[] {
    return this.factories().map((factory) => factory.descriptor);
  }

  factories(): DeviceFactory<TEvent>[] {
    return [...this.factoriesByDescriptorKey.values()];
  }

  createRuntimeDevice(instance: DeviceInstance): RuntimeDevice<TEvent> {
    const factory = this.findFactory(instance.descriptorKey);

    if (!factory) {
      return new MissingRuntimeDevice(instance);
    }

    return factory.create(instance);
  }
}

export class RuntimeDeviceRegistry<TEvent = unknown> {
  private readonly devicesByInstanceId = new Map<
    DeviceId,
    RuntimeDevice<TEvent>
  >();

  add(device: RuntimeDevice<TEvent>): RuntimeDevice<TEvent> {
    this.devicesByInstanceId.set(device.instanceId, device);
    return device;
  }

  remove(instanceId: DeviceId): RuntimeDevice<TEvent> | undefined {
    const device = this.devicesByInstanceId.get(instanceId);
    this.devicesByInstanceId.delete(instanceId);
    return device;
  }

  find(instanceId: DeviceId): RuntimeDevice<TEvent> | undefined {
    return this.devicesByInstanceId.get(instanceId);
  }

  get(instanceId: DeviceId): RuntimeDevice<TEvent> {
    const device = this.find(instanceId);

    if (!device) {
      throw new Error(`Runtime device not found: ${instanceId}`);
    }

    return device;
  }

  has(instanceId: DeviceId): boolean {
    return this.devicesByInstanceId.has(instanceId);
  }

  values(): RuntimeDevice<TEvent>[] {
    return [...this.devicesByInstanceId.values()];
  }

  clear(): void {
    this.devicesByInstanceId.clear();
  }
}
