import type {
  NodeCategory,
  NodeDescriptor,
  NodeParameterDescriptor,
  NodeParameterKind,
  NodeParameterOption,
  NodeParameterValue,
  NodePortDescriptor,
  NodePortDirection,
  NodeSignalKind
} from '@sequencer/nodes';

export type AudioGraphPortKind = NodeSignalKind;

export type AudioGraphPortDirection = NodePortDirection;

export type AudioGraphNodeCategory = NodeCategory;

export type AudioGraphParameterValue = NodeParameterValue;

export type AudioGraphParameterKind = NodeParameterKind;

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

export type AudioNodeDescriptor = NodeDescriptor;

export type AudioNodePortDescriptor = NodePortDescriptor;

export type AudioNodeParameterDescriptor = NodeParameterDescriptor;

export type AudioNodeParameterOption = NodeParameterOption;

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
