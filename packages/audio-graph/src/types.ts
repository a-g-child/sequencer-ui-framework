export type AudioGraphPortKind = 'midi' | 'audio' | 'control';

export type AudioGraphPortDirection = 'input' | 'output';

export type AudioGraphNodeCategory =
  | 'source'
  | 'processor'
  | 'control'
  | 'output';

export type AudioGraphParameterValue = string | number | boolean;

export type AudioGraphParameterKind = 'number' | 'choice' | 'boolean' | 'text';

export type AudioGraphDiagnosticSeverity = 'error' | 'warning';

export interface AudioGraphDocument {
  readonly id: string;
  readonly version: 1;
  readonly nodes: readonly AudioGraphNode[];
  readonly connections: readonly AudioGraphConnection[];
  readonly metadata?: AudioGraphMetadata;
}

export interface AudioGraphMetadata {
  readonly name?: string;
  readonly description?: string;
}

export interface AudioGraphNode {
  readonly id: string;
  readonly descriptorId: string;
  readonly name?: string;
  readonly parameters?: Readonly<Record<string, AudioGraphParameterValue>>;
  readonly position?: AudioGraphNodePosition;
}

export interface AudioGraphNodePosition {
  readonly x: number;
  readonly y: number;
}

export interface AudioGraphConnection {
  readonly id: string;
  readonly source: AudioGraphEndpoint;
  readonly target: AudioGraphEndpoint;
}

export interface AudioGraphEndpoint {
  readonly nodeId: string;
  readonly portId: string;
}

export interface AudioNodeDescriptor {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly category: AudioGraphNodeCategory;
  readonly ports: readonly AudioNodePortDescriptor[];
  readonly parameters?: readonly AudioNodeParameterDescriptor[];
  readonly latencySamples?: number;
}

export interface AudioNodePortDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: AudioGraphPortKind;
  readonly direction: AudioGraphPortDirection;
  readonly channels?: number;
}

export interface AudioNodeParameterDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: AudioGraphParameterKind;
  readonly defaultValue: AudioGraphParameterValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly options?: readonly AudioNodeParameterOption[];
}

export interface AudioNodeParameterOption {
  readonly label: string;
  readonly value: string | number | boolean;
}

export interface RuntimeAudioGraph {
  readonly document: AudioGraphDocument;
  readonly nodes: readonly RuntimeAudioGraphNode[];
  readonly connections: readonly RuntimeAudioGraphConnection[];
  readonly executionOrder: readonly string[];
  readonly latencySamples: number;
  readonly diagnostics: readonly AudioGraphDiagnostic[];
}

export interface RuntimeAudioGraphNode {
  readonly node: AudioGraphNode;
  readonly descriptor: AudioNodeDescriptor;
  readonly parameters: Readonly<Record<string, AudioGraphParameterValue>>;
  readonly inputPorts: readonly AudioNodePortDescriptor[];
  readonly outputPorts: readonly AudioNodePortDescriptor[];
}

export interface RuntimeAudioGraphConnection {
  readonly connection: AudioGraphConnection;
  readonly sourceNode: RuntimeAudioGraphNode;
  readonly sourcePort: AudioNodePortDescriptor;
  readonly targetNode: RuntimeAudioGraphNode;
  readonly targetPort: AudioNodePortDescriptor;
}

export interface AudioGraphDiagnostic {
  readonly severity: AudioGraphDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly nodeId?: string;
  readonly connectionId?: string;
}
