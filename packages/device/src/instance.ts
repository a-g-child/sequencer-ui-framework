import type { DeviceParameterValue } from './descriptor';

export type DeviceId = string;

export type DeviceInstance = {
  id: DeviceId;
  descriptorKey: string;
  name: string;
  parameterValues: Record<string, DeviceParameterValue>;
  missing?: boolean;
};
