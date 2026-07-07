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

export type DeviceParameterValue = number | boolean | string;

export type DeviceParameterDescriptor = {
  id: string;
  key: string;
  name: string;
  kind: DeviceParameterKind;
  defaultValue: DeviceParameterValue;
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
