import { DEFAULT_TRACK_PARAMETER_DEFINITIONS } from "./default-parameter-definitions";
import {
  createParameter,
  createParameterDefinition
} from "./parameter";
import type {
  ParameterDefinition,
  ParameterKind,
  ParameterValue
} from "./parameter";
import type { SequencerDocument } from "./document";
import type { Track } from "./project";

interface DefaultParameterDefinition<
  T extends ParameterValue = ParameterValue
> {
  key: string;
  name: string;
  kind: ParameterKind;
  defaultValue: T;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export function addDefaultTrackParameters(
  document: SequencerDocument,
  track: Track
): void {
  for (const defaultDefinition of Object.values(
    DEFAULT_TRACK_PARAMETER_DEFINITIONS
  )) {
    const definition = getOrCreateParameterDefinition(
      document,
      defaultDefinition
    );
    const parameter = createParameter(
      definition.name,
      definition.id,
      definition.defaultValue
    );

    document.parameters.add(parameter);
    track.parameters.push(parameter.id);
  }
}

function getOrCreateParameterDefinition<T extends ParameterValue>(
  document: SequencerDocument,
  defaultDefinition: DefaultParameterDefinition<T>
): ParameterDefinition<T> {
  const existing = document.parameterDefinitions.findByKey(
    defaultDefinition.key
  );

  if (existing) {
    return existing as ParameterDefinition<T>;
  }

  const { key, name, kind, defaultValue, ...options } = defaultDefinition;
  const definition = createParameterDefinition(name, kind, defaultValue, {
    key,
    ...options
  });

  document.parameterDefinitions.add(definition);

  return definition;
}
