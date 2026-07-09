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
  readonly nodeDiagnostics: readonly RuntimeNodeDiagnostics[];
}

export interface ExecutionPlan {
  readonly graph: RuntimeAudioGraph;
  readonly nodes: readonly ExecutionPlanNode[];
  readonly executionBlocks: readonly ExecutionPlanBlock[];
  readonly diagnostics: readonly AudioGraphDiagnostic[];
}

export interface ExecutionPlanNode {
  readonly nodeId: string;
  readonly descriptorId: string;
  readonly executionIndex: number;
  readonly inputConnectionIds: readonly string[];
  readonly outputConnectionIds: readonly string[];
  readonly latencySamples: number;
}

export interface ExecutionPlanBlock {
  readonly id: string;
  readonly nodeIds: readonly string[];
}

export interface RuntimeAudioGraphNode {
  readonly id: string;
  readonly descriptorId: string;
  readonly node: AudioGraphNode;
  readonly descriptor: AudioNodeDescriptor;
  readonly parameters: Readonly<Record<string, AudioGraphParameterValue>>;
  readonly resolvedPorts: RuntimeAudioGraphNodePorts;
  readonly inputPorts: readonly AudioNodePortDescriptor[];
  readonly outputPorts: readonly AudioNodePortDescriptor[];
  readonly executionIndex: number;
}

export interface RuntimeAudioGraphNodePorts {
  readonly inputs: readonly AudioNodePortDescriptor[];
  readonly outputs: readonly AudioNodePortDescriptor[];
}

export interface RuntimeAudioGraphConnection {
  readonly connection: AudioGraphConnection;
  readonly sourceNode: RuntimeAudioGraphNode;
  readonly sourcePort: AudioNodePortDescriptor;
  readonly targetNode: RuntimeAudioGraphNode;
  readonly targetPort: AudioNodePortDescriptor;
}

export type RuntimeNodeDiagnostics = {
  readonly nodeId: string;
  readonly descriptorId: string;
  readonly executionIndex: number;
  readonly lastProcessMs?: number;
  readonly averageProcessMs?: number;
  readonly peakProcessMs?: number;
  readonly latencySamples?: number;
};

export type ExecutionExecutorStatus =
  | 'idle'
  | 'initialised'
  | 'running'
  | 'shutdown';

export interface ExecutionProcessContext {
  readonly currentTimeMs: number;
  readonly frameCount?: number;
  readonly sampleRate?: number;
}

export interface ExecutionParameterUpdate {
  readonly nodeId: string;
  readonly parameterId: string;
  readonly value: AudioGraphParameterValue;
  readonly timeMs?: number;
}

export interface ExecutionProcessResult {
  readonly nodeDiagnostics?: readonly RuntimeNodeDiagnostics[];
}

export interface ExecutionExecutor {
  readonly id: string;
  readonly name: string;
  readonly status: ExecutionExecutorStatus;

  initialise(graph: RuntimeAudioGraph): Promise<void>;
  updateParameters(updates: readonly ExecutionParameterUpdate[]): void;
  process(context: ExecutionProcessContext): ExecutionProcessResult | void;
  shutdown(): void;
}

export interface AudioGraphDiagnostic {
  readonly severity: AudioGraphDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly nodeId?: string;
  readonly connectionId?: string;
}
