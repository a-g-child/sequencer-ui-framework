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
  modulationValue?: number;
  smoothedValue?: number;
  effectiveValue?: RuntimeParameterValue;
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

export function getRuntimeParameterEffectiveValue(
  parameters: readonly RuntimeParameter[],
  key: string
): RuntimeParameterValue | undefined {
  const parameter = getRuntimeParameter(parameters, key);

  return parameter?.effectiveValue ?? parameter?.value;
}

export function setRuntimeParameterValue(
  parameter: RuntimeParameter,
  value: RuntimeParameterValue
): void {
  parameter.targetValue = value;

  if (typeof value !== 'number') {
    parameter.value = value;
    parameter.effectiveValue = value;
  }
}

export function setRuntimeParameterModulation(
  parameter: RuntimeParameter,
  value: number
): void {
  parameter.modulationValue = Number.isFinite(value) ? value : 0;
  updateRuntimeParameterEffectiveValue(parameter);
}

export function clearRuntimeParameterModulation(
  parameter: RuntimeParameter
): void {
  parameter.modulationValue = 0;
  updateRuntimeParameterEffectiveValue(parameter);
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
      parameter.effectiveValue = parameter.targetValue;
      continue;
    }

    const smoothingMs = parameter.smoothingMs ?? 0;

    if (smoothingMs <= 0) {
      parameter.value = parameter.targetValue;
      parameter.smoothedValue = parameter.targetValue;
      updateRuntimeParameterEffectiveValue(parameter);
      continue;
    }

    const amount = Math.min(1, deltaMs / smoothingMs);

    parameter.smoothedValue +=
      (parameter.targetValue - parameter.smoothedValue) * amount;

    parameter.value = parameter.smoothedValue;
    updateRuntimeParameterEffectiveValue(parameter);
  }
}

function updateRuntimeParameterEffectiveValue(parameter: RuntimeParameter): void {
  if (typeof parameter.value !== 'number') {
    parameter.effectiveValue = parameter.value;
    return;
  }

  parameter.effectiveValue =
    parameter.value + (parameter.modulationValue ?? 0);
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
    modulationValue: typeof value === 'number' ? 0 : undefined,
    smoothedValue: typeof value === 'number' ? value : undefined,
    effectiveValue: value,
    smoothingMs: typeof value === 'number' ? 20 : undefined
  };
}
