import type { Entity } from "./entity";

export type ParameterValue = number | string | boolean;

export type ParameterKind =
  | "number"
  | "boolean"
  | "choice"
  | "text";

export interface ParameterOption<T extends ParameterValue = ParameterValue> {
  label: string;
  value: T;
}

export interface ParameterDefinition<
  T extends ParameterValue = ParameterValue
> extends Entity {
  kind: ParameterKind;
  defaultValue: T;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: ParameterOption<T>[];
}

export interface Parameter<
  T extends ParameterValue = ParameterValue
> extends Entity {
  definitionId: string;
  value: T;
}