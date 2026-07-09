export type NodeSignalKind =
  | 'audio'
  | 'stereo-audio'
  | 'midi'
  | 'gate'
  | 'trigger'
  | 'control'
  | 'boolean'
  | 'cv'
  | 'gpio'
  | 'serial'
  | 'network'
  | 'lighting';

export type NodePortDirection = 'input' | 'output';

export type NodeCategory =
  | 'audio'
  | 'midi'
  | 'control'
  | 'converter'
  | 'hardware'
  | 'source'
  | 'processor'
  | 'output'
  | 'utility';

export type NodeCapability =
  | 'instrument-source'
  | 'audio-processor'
  | 'midi-processor'
  | 'control-source'
  | 'control-processor'
  | 'converter'
  | 'hardware-io'
  | 'routing'
  | 'modulation'
  | 'timing';

export type NodeParameterValue = string | number | boolean;

export type NodeParameterKind = 'number' | 'choice' | 'boolean' | 'text';

export interface NodeDescriptor {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly category: NodeCategory;
  readonly capabilities?: readonly NodeCapability[];
  readonly ports: readonly NodePortDescriptor[];
  readonly parameters?: readonly NodeParameterDescriptor[];
  readonly latencySamples?: number;
}

export interface NodePortDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: NodeSignalKind;
  readonly direction: NodePortDirection;
  readonly channels?: number;
}

export interface NodeParameterDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: NodeParameterKind;
  readonly defaultValue: NodeParameterValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly options?: readonly NodeParameterOption[];
}

export interface NodeParameterOption {
  readonly label: string;
  readonly value: NodeParameterValue;
}
