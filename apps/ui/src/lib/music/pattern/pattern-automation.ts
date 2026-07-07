import type { Parameter, ParameterDefinition } from '@sequencer/core';
import type {
  DeviceInstance,
  DeviceParameterDescriptor,
  DeviceParameterValue
} from '@sequencer/device';

export type PatternAutomationTarget = {
  parameter: Parameter<number>;
  definition: ParameterDefinition<number>;
  label: string;
  value: number;
  min: number;
  max: number;
};

export type PatternDeviceAutomationParameter = {
  device: DeviceInstance;
  descriptor: DeviceParameterDescriptor;
  value: DeviceParameterValue;
};

export type AutomationCurvePoint = {
  beat: number;
  value: number;
};

export type AutomationBezierSegment = {
  start: AutomationCurvePoint;
  control1: AutomationCurvePoint;
  control2: AutomationCurvePoint;
  end: AutomationCurvePoint;
};

export function buildPatternAutomationTargets(
  properties: Array<{
    parameter: Parameter;
    definition: ParameterDefinition;
  }>,
  deviceParameters: PatternDeviceAutomationParameter[] = []
): PatternAutomationTarget[] {
  const trackTargets = properties.flatMap(({ parameter, definition }) => {
    if (definition.kind !== 'number' || typeof parameter.value !== 'number') {
      return [];
    }

    return [{
      parameter: parameter as Parameter<number>,
      definition: definition as ParameterDefinition<number>,
      label: definition.name,
      value: parameter.value,
      min: definition.min ?? 0,
      max: definition.max ?? 1
    }];
  });

  const deviceTargets = deviceParameters.flatMap(({ device, descriptor, value }) => {
    if (descriptor.kind !== 'number' || typeof value !== 'number') {
      return [];
    }

    const definition: ParameterDefinition<number> = {
      id: `device-paramdef:${device.descriptorKey}:${descriptor.key}`,
      name: descriptor.name,
      kind: 'number',
      defaultValue: Number(descriptor.defaultValue),
      min: descriptor.min,
      max: descriptor.max,
      step: descriptor.step,
      unit: descriptor.unit
    };
    const parameter: Parameter<number> = {
      id: deviceAutomationTargetId(device.id, descriptor.key),
      name: descriptor.name,
      definitionId: definition.id,
      value
    };

    return [{
      parameter,
      definition,
      label: `${device.name} / ${descriptor.name}`,
      value,
      min: descriptor.min ?? 0,
      max: descriptor.max ?? 1
    }];
  });

  return [...trackTargets, ...deviceTargets];
}

export function deviceAutomationTargetId(
  deviceInstanceId: string,
  parameterKey: string
): string {
  return `device:${deviceInstanceId}:${parameterKey}`;
}

export function createConstantAutomationSegment(
  value: number,
  startBeat: number,
  endBeat: number
): AutomationBezierSegment {
  const beatRange = Math.max(0, endBeat - startBeat);

  return {
    start: { beat: startBeat, value },
    control1: { beat: startBeat + beatRange / 3, value },
    control2: { beat: startBeat + (beatRange * 2) / 3, value },
    end: { beat: endBeat, value }
  };
}

export function createAutomationSegments(
  points: AutomationCurvePoint[],
  fallbackValue: number,
  startBeat: number,
  endBeat: number
): AutomationBezierSegment[] {
  const sortedPoints = sortAutomationPoints(points, startBeat, endBeat);
  const anchors = [
    { beat: startBeat, value: sortedPoints[0]?.value ?? fallbackValue },
    ...sortedPoints,
    { beat: endBeat, value: sortedPoints.at(-1)?.value ?? fallbackValue }
  ];
  const segments: AutomationBezierSegment[] = [];

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index];
    const end = anchors[index + 1];

    if (end.beat <= start.beat) continue;

    segments.push(createLinearBezierSegment(start, end));
  }

  return segments.length > 0
    ? segments
    : [createConstantAutomationSegment(fallbackValue, startBeat, endBeat)];
}

export function automationSegmentsToSvgPath(
  segments: AutomationBezierSegment[],
  width: number,
  height: number,
  min: number,
  max: number
): string {
  if (segments.length === 0) return '';

  const startBeat = segments[0].start.beat;
  const endBeat = segments.at(-1)?.end.beat ?? startBeat;
  const first = automationPointToGlobalScreen(
    segments[0].start,
    startBeat,
    endBeat,
    width,
    height,
    min,
    max
  );
  const commands = [`M ${first.x} ${first.y}`];

  for (const segment of segments) {
    const control1 = automationPointToGlobalScreen(
      segment.control1,
      startBeat,
      endBeat,
      width,
      height,
      min,
      max
    );
    const control2 = automationPointToGlobalScreen(
      segment.control2,
      startBeat,
      endBeat,
      width,
      height,
      min,
      max
    );
    const end = automationPointToGlobalScreen(
      segment.end,
      startBeat,
      endBeat,
      width,
      height,
      min,
      max
    );

    commands.push(
      `C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`
    );
  }

  return commands.join(' ');
}

export function automationSegmentToSvgPath(
  segment: AutomationBezierSegment,
  width: number,
  height: number,
  min: number,
  max: number
): string {
  const start = automationPointToScreen(segment.start, segment, width, height, min, max);
  const control1 = automationPointToScreen(segment.control1, segment, width, height, min, max);
  const control2 = automationPointToScreen(segment.control2, segment, width, height, min, max);
  const end = automationPointToScreen(segment.end, segment, width, height, min, max);

  return [
    `M ${start.x} ${start.y}`,
    `C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`
  ].join(' ');
}

export function sampleAutomationSegment(
  segment: AutomationBezierSegment,
  beat: number
): number {
  const t = solveBezierTimeForBeat(segment, beat);

  return cubicBezier(
    segment.start.value,
    segment.control1.value,
    segment.control2.value,
    segment.end.value,
    t
  );
}

export function sampleAutomationSegments(
  segments: AutomationBezierSegment[],
  beat: number
): number {
  const segment = segments.find(
    (item) => beat >= item.start.beat && beat <= item.end.beat
  ) ?? segments.at(-1);

  return segment ? sampleAutomationSegment(segment, beat) : 0;
}

export function normaliseAutomationValue(
  value: number,
  min: number,
  max: number
): number {
  const range = max - min;

  if (!Number.isFinite(range) || range === 0) return 0;

  return Math.min(1, Math.max(0, (value - min) / range));
}

export function denormaliseAutomationValue(
  normalisedValue: number,
  min: number,
  max: number
): number {
  return min + Math.min(1, Math.max(0, normalisedValue)) * (max - min);
}

function sortAutomationPoints(
  points: AutomationCurvePoint[],
  startBeat: number,
  endBeat: number
): AutomationCurvePoint[] {
  return points
    .map((point) => ({
      beat: Math.min(endBeat, Math.max(startBeat, point.beat)),
      value: point.value
    }))
    .sort((left, right) => left.beat - right.beat);
}

function createLinearBezierSegment(
  start: AutomationCurvePoint,
  end: AutomationCurvePoint
): AutomationBezierSegment {
  const beatRange = end.beat - start.beat;

  return {
    start,
    control1: {
      beat: start.beat + beatRange / 3,
      value: start.value + (end.value - start.value) / 3
    },
    control2: {
      beat: start.beat + (beatRange * 2) / 3,
      value: start.value + ((end.value - start.value) * 2) / 3
    },
    end
  };
}

function automationPointToScreen(
  point: AutomationCurvePoint,
  segment: AutomationBezierSegment,
  width: number,
  height: number,
  min: number,
  max: number
): { x: number; y: number } {
  const beatRange = segment.end.beat - segment.start.beat;
  const beatPosition = beatRange === 0
    ? 0
    : (point.beat - segment.start.beat) / beatRange;
  const valuePosition = normaliseAutomationValue(point.value, min, max);

  return {
    x: Math.min(1, Math.max(0, beatPosition)) * width,
    y: height - valuePosition * height
  };
}

function automationPointToGlobalScreen(
  point: AutomationCurvePoint,
  startBeat: number,
  endBeat: number,
  width: number,
  height: number,
  min: number,
  max: number
): { x: number; y: number } {
  const beatRange = endBeat - startBeat;
  const beatPosition = beatRange === 0
    ? 0
    : (point.beat - startBeat) / beatRange;
  const valuePosition = normaliseAutomationValue(point.value, min, max);

  return {
    x: Math.min(1, Math.max(0, beatPosition)) * width,
    y: height - valuePosition * height
  };
}

function solveBezierTimeForBeat(
  segment: AutomationBezierSegment,
  beat: number
): number {
  const minBeat = Math.min(segment.start.beat, segment.end.beat);
  const maxBeat = Math.max(segment.start.beat, segment.end.beat);
  const targetBeat = Math.min(maxBeat, Math.max(minBeat, beat));
  let low = 0;
  let high = 1;

  for (let index = 0; index < 24; index += 1) {
    const midpoint = (low + high) / 2;
    const currentBeat = cubicBezier(
      segment.start.beat,
      segment.control1.beat,
      segment.control2.beat,
      segment.end.beat,
      midpoint
    );

    if (currentBeat < targetBeat) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return (low + high) / 2;
}

function cubicBezier(
  start: number,
  control1: number,
  control2: number,
  end: number,
  t: number
): number {
  const inverseT = 1 - t;

  return (
    inverseT ** 3 * start +
    3 * inverseT ** 2 * t * control1 +
    3 * inverseT * t ** 2 * control2 +
    t ** 3 * end
  );
}
