import type {
  DeviceDescriptor,
  DeviceParameterDescriptor,
  DeviceParameterValue
} from './descriptor';
import type { DeviceInstance } from './instance';

export type RuntimeParameterValue = DeviceParameterValue;

export type RuntimeParameter = {
  id: string;
  key: string;
  name: string;
  value: RuntimeParameterValue;
  targetValue: RuntimeParameterValue;
  defaultValue: RuntimeParameterValue;
  smoothedValue?: number;
};

export function createRuntimeParameters(
  descriptor: DeviceDescriptor,
  instance: DeviceInstance
): RuntimeParameter[] {
  return descriptor.parameters.map((parameter) =>
    createRuntimeParameter(parameter, instance.parameterValues[parameter.key])
  );
}

export function getRuntimeParameter(
  parameters: readonly RuntimeParameter[],
  key: string
): RuntimeParameter | undefined {
  return parameters.find((parameter) => parameter.key === key);
}

export function getRuntimeParameterValue(
  parameters: readonly RuntimeParameter[],
  key: string
): RuntimeParameterValue | undefined {
  return getRuntimeParameter(parameters, key)?.value;
}

export function setRuntimeParameterValue(
  parameters: readonly RuntimeParameter[],
  key: string,
  value: RuntimeParameterValue
): RuntimeParameter | undefined {
  const parameter = getRuntimeParameter(parameters, key);

  if (!parameter) return undefined;

  parameter.value = value;
  parameter.targetValue = value;

  if (typeof value === 'number') {
    parameter.smoothedValue = value;
  }

  return parameter;
}

function createRuntimeParameter(
  descriptor: DeviceParameterDescriptor,
  instanceValue: RuntimeParameterValue | undefined
): RuntimeParameter {
  const value = instanceValue ?? descriptor.defaultValue;

  return {
    id: descriptor.id,
    key: descriptor.key,
    name: descriptor.name,
    value,
    targetValue: value,
    defaultValue: descriptor.defaultValue,
    smoothedValue: typeof value === 'number' ? value : undefined
  };
}
