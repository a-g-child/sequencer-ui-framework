import type { ExecutionPlan, RuntimeAudioGraph } from './types.ts';
import { createExecutionPlan } from './execution-plan.ts';

export type NativeExecutionRate = 'audio-rate' | 'control-rate' | 'event-rate';

export interface NativeExecutionPlan {
  readonly id: string;
  readonly graphId: string;
  readonly revision: number;
  readonly nodes: readonly NativeExecutionPlanNode[];
  readonly buffers: readonly NativeAudioBufferSlot[];
  readonly parameters: readonly NativeParameterSlot[];
  readonly eventRoutes: readonly NativeEventRoute[];
  readonly executionGroups: readonly NativeExecutionGroup[];
  readonly latencySamples: number;
}

export interface NativeExecutionPlanNode {
  readonly nodeId: string;
  readonly descriptorId: string;
  readonly executionIndex: number;
  readonly inputBufferIds: readonly string[];
  readonly outputBufferIds: readonly string[];
  readonly parameterSlotIds: readonly string[];
  readonly rate: NativeExecutionRate;
}

export interface NativeAudioBufferSlot {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly sourcePortId: string;
  readonly channels?: number;
}

export interface NativeParameterSlot {
  readonly id: string;
  readonly nodeId: string;
  readonly parameterId: string;
  readonly defaultValue: number | boolean | string;
}

export interface NativeEventRoute {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly sourcePortId: string;
  readonly targetNodeId: string;
  readonly targetPortId: string;
}

export interface NativeExecutionGroup {
  readonly id: string;
  readonly rate: NativeExecutionRate;
  readonly nodeIds: readonly string[];
}

export function createNativeExecutionPlan(
  graph: RuntimeAudioGraph
): NativeExecutionPlan {
  const plan = createExecutionPlan(graph);
  const buffers = createBufferSlots(graph);
  const parameters = createParameterSlots(graph);
  const eventRoutes = createEventRoutes(graph);
  const nodes = plan.nodes.map((node) =>
    createNativeExecutionPlanNode(node, graph, buffers, parameters)
  );
  const executionGroups = groupNodesByExecutionRate(nodes);

  return {
    id: `native-plan:${graph.document.id}`,
    graphId: graph.document.id,
    revision: 1,
    nodes,
    buffers,
    parameters,
    eventRoutes,
    executionGroups,
    latencySamples: graph.latencySamples
  };
}

function createNativeExecutionPlanNode(
  node: ExecutionPlan['nodes'][number],
  graph: RuntimeAudioGraph,
  buffers: readonly NativeAudioBufferSlot[],
  parameters: readonly NativeParameterSlot[]
): NativeExecutionPlanNode {
  const runtimeNode = graph.nodes.find((candidate) => candidate.id === node.nodeId);
  const rate = runtimeNode ? executionRateForNode(runtimeNode.descriptor.category) : 'event-rate';

  return {
    nodeId: node.nodeId,
    descriptorId: node.descriptorId,
    executionIndex: node.executionIndex,
    inputBufferIds: graph.connections
      .filter(
        (connection) =>
          connection.targetNode.id === node.nodeId &&
          isAudioLikeKind(connection.targetPort.kind)
      )
      .map((connection) => bufferSlotId(connection.sourceNode.id, connection.sourcePort.id)),
    outputBufferIds: buffers
      .filter((buffer) => buffer.sourceNodeId === node.nodeId)
      .map((buffer) => buffer.id),
    parameterSlotIds: parameters
      .filter((parameter) => parameter.nodeId === node.nodeId)
      .map((parameter) => parameter.id),
    rate
  };
}

function createBufferSlots(graph: RuntimeAudioGraph): NativeAudioBufferSlot[] {
  const slots = new Map<string, NativeAudioBufferSlot>();

  for (const node of graph.nodes) {
    for (const port of node.outputPorts) {
      if (!isAudioLikeKind(port.kind)) continue;

      slots.set(bufferSlotId(node.id, port.id), {
        id: bufferSlotId(node.id, port.id),
        sourceNodeId: node.id,
        sourcePortId: port.id,
        channels: port.channels
      });
    }
  }

  return [...slots.values()];
}

function createParameterSlots(graph: RuntimeAudioGraph): NativeParameterSlot[] {
  return graph.nodes.flatMap((node) =>
    (node.descriptor.parameters ?? []).map((parameter) => ({
      id: parameterSlotId(node.id, parameter.id),
      nodeId: node.id,
      parameterId: parameter.id,
      defaultValue: node.parameters[parameter.id] ?? parameter.defaultValue
    }))
  );
}

function createEventRoutes(graph: RuntimeAudioGraph): NativeEventRoute[] {
  return graph.connections
    .filter(
      (connection) =>
        !isAudioLikeKind(connection.sourcePort.kind) ||
        !isAudioLikeKind(connection.targetPort.kind)
    )
    .map((connection) => ({
      id: connection.connection.id,
      sourceNodeId: connection.sourceNode.id,
      sourcePortId: connection.sourcePort.id,
      targetNodeId: connection.targetNode.id,
      targetPortId: connection.targetPort.id
    }));
}

function groupNodesByExecutionRate(
  nodes: readonly NativeExecutionPlanNode[]
): NativeExecutionGroup[] {
  const groups: NativeExecutionGroup[] = [];

  for (const rate of ['event-rate', 'control-rate', 'audio-rate'] as const) {
    const nodeIds = nodes
      .filter((node) => node.rate === rate)
      .map((node) => node.nodeId);

    if (nodeIds.length === 0) continue;

    groups.push({
      id: `group:${rate}`,
      rate,
      nodeIds
    });
  }

  return groups;
}

function executionRateForNode(category: string): NativeExecutionRate {
  if (category === 'audio' || category === 'source' || category === 'output') {
    return 'audio-rate';
  }

  if (category === 'control') {
    return 'control-rate';
  }

  return 'event-rate';
}

function isAudioLikeKind(kind: string): boolean {
  return kind === 'audio' || kind === 'stereo-audio';
}

function bufferSlotId(nodeId: string, portId: string): string {
  return `buffer:${nodeId}:${portId}`;
}

function parameterSlotId(nodeId: string, parameterId: string): string {
  return `parameter:${nodeId}:${parameterId}`;
}
