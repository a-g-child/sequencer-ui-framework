import type {
  ExecutionPlan,
  ExecutionPlanBlock,
  ExecutionPlanNode,
  RuntimeAudioGraph
} from './types.ts';

export function createExecutionPlan(graph: RuntimeAudioGraph): ExecutionPlan {
  const nodes = graph.nodes
    .map((node): ExecutionPlanNode => ({
      nodeId: node.id,
      descriptorId: node.descriptorId,
      executionIndex: node.executionIndex,
      inputConnectionIds: graph.connections
        .filter((connection) => connection.targetNode.id === node.id)
        .map((connection) => connection.connection.id),
      outputConnectionIds: graph.connections
        .filter((connection) => connection.sourceNode.id === node.id)
        .map((connection) => connection.connection.id),
      latencySamples: node.descriptor.latencySamples ?? 0
    }))
    .sort((left, right) => left.executionIndex - right.executionIndex);
  const executionBlocks: ExecutionPlanBlock[] = nodes.map((node) => ({
    id: `block-${node.executionIndex}`,
    nodeIds: [node.nodeId]
  }));

  return {
    graph,
    nodes,
    executionBlocks,
    diagnostics: graph.diagnostics
  };
}
