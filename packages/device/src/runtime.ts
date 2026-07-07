import type { DeviceId, DeviceInstance } from './instance';
import type { RuntimeParameter } from './parameter-runtime';

export type RuntimeDeviceStatus = 'idle' | 'connected' | 'missing';

export interface RuntimeDevice<TEvent = unknown> {
  readonly instanceId: DeviceId;
  readonly descriptorKey: string;
  readonly status: RuntimeDeviceStatus;
  readonly parameters: readonly RuntimeParameter[];

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  processEvents(events: readonly TEvent[]): void;
}

export class MissingRuntimeDevice<TEvent = unknown>
  implements RuntimeDevice<TEvent>
{
  readonly status = 'missing';
  readonly parameters: readonly RuntimeParameter[] = [];

  constructor(readonly instance: DeviceInstance) {}

  get instanceId(): DeviceId {
    return this.instance.id;
  }

  get descriptorKey(): string {
    return this.instance.descriptorKey;
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  processEvents(_events: readonly TEvent[]): void {}
}

export abstract class BaseRuntimeDevice<TEvent = unknown>
  implements RuntimeDevice<TEvent>
{
  private connected = false;

  constructor(
    readonly instance: DeviceInstance,
    readonly parameters: readonly RuntimeParameter[] = []
  ) {}

  get instanceId(): DeviceId {
    return this.instance.id;
  }

  get descriptorKey(): string {
    return this.instance.descriptorKey;
  }

  get status(): RuntimeDeviceStatus {
    return this.connected ? 'connected' : 'idle';
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  processEvents(_events: readonly TEvent[]): void {}
}
