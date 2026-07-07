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
  descriptor: DeviceParameterDescriptor;
  value: RuntimeParameterValue;
  targetValue: RuntimeParameterValue;
  defaultValue: RuntimeParameterValue;
  smoothedValue?: number;
  smoothingMs?: number;
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
  parameter: RuntimeParameter,
  value: RuntimeParameterValue
): void {
  parameter.targetValue = value;

  if (typeof value !== 'number') {
    parameter.value = value;
  }
}

export function advanceRuntimeParameters(
  parameters: RuntimeParameter[],
  deltaMs: number
): void {
  for (const parameter of parameters) {
    if (
      typeof parameter.targetValue !== 'number' ||
      typeof parameter.smoothedValue !== 'number'
    ) {
      parameter.value = parameter.targetValue;
      continue;
    }

    const smoothingMs = parameter.smoothingMs ?? 0;

    if (smoothingMs <= 0) {
      parameter.value = parameter.targetValue;
      parameter.smoothedValue = parameter.targetValue;
      continue;
    }

    const amount = Math.min(1, deltaMs / smoothingMs);

    parameter.smoothedValue +=
      (parameter.targetValue - parameter.smoothedValue) * amount;

    parameter.value = parameter.smoothedValue;
  }
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
    descriptor,
    value,
    targetValue: value,
    defaultValue: descriptor.defaultValue,
    smoothedValue: typeof value === 'number' ? value : undefined,
    smoothingMs: typeof value === 'number' ? 20 : undefined
  };
}
