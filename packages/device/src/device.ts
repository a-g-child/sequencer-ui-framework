export type DeviceId = string;

export type DeviceCapability =
  | 'instrument'
  | 'sampler'
  | 'audio-effect'
  | 'midi-output'
  | 'audio-output'
  | 'automation-target'
  | 'hardware-module'
  | 'network-device';

export type DevicePortKind =
  | 'midi-in'
  | 'midi-out'
  | 'audio-in'
  | 'audio-out'
  | 'control-in'
  | 'control-out';

export type DevicePort = {
  id: string;
  name: string;
  kind: DevicePortKind;
  channels?: number;
};

export type DeviceParameterKind =
  | 'number'
  | 'boolean'
  | 'choice'
  | 'text';

export type DeviceParameterDescriptor = {
  id: string;
  key: string;
  name: string;
  kind: DeviceParameterKind;
  defaultValue: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
  unit?: string;
};

export type DeviceDescriptor = {
  id: string;
  key: string;
  name: string;
  manufacturer?: string;
  version?: string;
  capabilities: DeviceCapability[];
  ports: DevicePort[];
  parameters: DeviceParameterDescriptor[];
};

export type DeviceInstance = {
  id: DeviceId;
  descriptorKey: string;
  name: string;
  parameterValues: Record<string, number | boolean | string>;
  missing?: boolean;
};
