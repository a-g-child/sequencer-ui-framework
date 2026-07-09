import type {
  AudioGraphConnection,
  AudioGraphDiagnostic,
  AudioGraphDocument,
  AudioGraphEndpoint,
  AudioNodeDescriptor,
  AudioNodePortDescriptor,
  RuntimeAudioGraph,
  RuntimeAudioGraphConnection,
  RuntimeAudioGraphNode
} from './types.ts';

export class AudioGraphBuilder {
  private readonly descriptors = new Map<string, AudioNodeDescriptor>();

  constructor(descriptors: readonly AudioNodeDescriptor[]) {
    for (const descriptor of descriptors) {
      this.descriptors.set(descriptor.id, descriptor);
    }
  }

  build(document: AudioGraphDocument): RuntimeAudioGraph {
    const diagnostics: AudioGraphDiagnostic[] = [];
    const nodes = this.resolveNodes(document, diagnostics);
    const nodeMap = new Map(nodes.map((node) => [node.node.id, node]));
    const connections = this.resolveConnections(
      document.connections,
      nodeMap,
      diagnostics
    );

    return {
      document,
      nodes,
      connections,
      executionOrder: resolveExecutionOrder(nodes, connections, diagnostics),
      latencySamples: nodes.reduce(
        (total, node) => total + (node.descriptor.latencySamples ?? 0),
        0
      ),
      diagnostics
    };
  }

  private resolveNodes(
    document: AudioGraphDocument,
    diagnostics: AudioGraphDiagnostic[]
  ): RuntimeAudioGraphNode[] {
    const seenNodeIds = new Set<string>();
    const nodes: RuntimeAudioGraphNode[] = [];

    for (const node of document.nodes) {
      if (seenNodeIds.has(node.id)) {
        diagnostics.push({
          severity: 'error',
          code: 'duplicate-node-id',
          message: `Duplicate graph node id "${node.id}".`,
          nodeId: node.id
        });
        continue;
      }

      seenNodeIds.add(node.id);

      const descriptor = this.descriptors.get(node.descriptorId);

      if (!descriptor) {
        diagnostics.push({
          severity: 'error',
          code: 'unknown-node-descriptor',
          message: `Node "${node.id}" references unknown descriptor "${node.descriptorId}".`,
          nodeId: node.id
        });
        continue;
      }

      nodes.push({
        node,
        descriptor,
        parameters: resolveParameters(descriptor, node.parameters ?? {}),
        inputPorts: descriptor.ports.filter((port) => port.direction === 'input'),
        outputPorts: descriptor.ports.filter((port) => port.direction === 'output')
      });
    }

    return nodes;
  }

  private resolveConnections(
    connections: readonly AudioGraphConnection[],
    nodeMap: ReadonlyMap<string, RuntimeAudioGraphNode>,
    diagnostics: AudioGraphDiagnostic[]
  ): RuntimeAudioGraphConnection[] {
    const seenConnectionIds = new Set<string>();
    const runtimeConnections: RuntimeAudioGraphConnection[] = [];

    for (const connection of connections) {
      if (seenConnectionIds.has(connection.id)) {
        diagnostics.push({
          severity: 'error',
          code: 'duplicate-connection-id',
          message: `Duplicate graph connection id "${connection.id}".`,
          connectionId: connection.id
        });
        continue;
      }

      seenConnectionIds.add(connection.id);

      const resolved = this.resolveConnection(connection, nodeMap, diagnostics);

      if (resolved) {
        runtimeConnections.push(resolved);
      }
    }

    return runtimeConnections;
  }

  private resolveConnection(
    connection: AudioGraphConnection,
    nodeMap: ReadonlyMap<string, RuntimeAudioGraphNode>,
    diagnostics: AudioGraphDiagnostic[]
  ): RuntimeAudioGraphConnection | undefined {
    const sourceNode = nodeMap.get(connection.source.nodeId);
    const targetNode = nodeMap.get(connection.target.nodeId);

    if (!sourceNode) {
      diagnostics.push(missingNodeDiagnostic(connection, connection.source));
      return undefined;
    }

    if (!targetNode) {
      diagnostics.push(missingNodeDiagnostic(connection, connection.target));
      return undefined;
    }

    const sourcePort = findPort(sourceNode, connection.source);
    const targetPort = findPort(targetNode, connection.target);

    if (!sourcePort) {
      diagnostics.push(missingPortDiagnostic(connection, connection.source));
      return undefined;
    }

    if (!targetPort) {
      diagnostics.push(missingPortDiagnostic(connection, connection.target));
      return undefined;
    }

    if (sourcePort.direction !== 'output' || targetPort.direction !== 'input') {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-port-direction',
        message: `Connection "${connection.id}" must connect an output port to an input port.`,
        connectionId: connection.id
      });
      return undefined;
    }

    if (!arePortsCompatible(sourcePort, targetPort)) {
      diagnostics.push({
        severity: 'error',
        code: 'incompatible-port-kind',
        message: `Connection "${connection.id}" cannot connect ${sourcePort.kind} output to ${targetPort.kind} input.`,
        connectionId: connection.id
      });
      return undefined;
    }

    if (
      sourcePort.kind === 'audio' &&
      sourcePort.channels !== undefined &&
      targetPort.channels !== undefined &&
      sourcePort.channels !== targetPort.channels
    ) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-channel-mismatch',
        message: `Connection "${connection.id}" connects ${sourcePort.channels} channel audio to ${targetPort.channels} channel audio.`,
        connectionId: connection.id
      });
    }

    return {
      connection,
      sourceNode,
      sourcePort,
      targetNode,
      targetPort
    };
  }
}

function arePortsCompatible(
  sourcePort: AudioNodePortDescriptor,
  targetPort: AudioNodePortDescriptor
): boolean {
  return sourcePort.kind === targetPort.kind;
}

function resolveParameters(
  descriptor: AudioNodeDescriptor,
  values: Readonly<Record<string, string | number | boolean>>
): Readonly<Record<string, string | number | boolean>> {
  const resolved: Record<string, string | number | boolean> = {};

  for (const parameter of descriptor.parameters ?? []) {
    resolved[parameter.id] = values[parameter.id] ?? parameter.defaultValue;
  }

  for (const [key, value] of Object.entries(values)) {
    resolved[key] = value;
  }

  return resolved;
}

function findPort(
  node: RuntimeAudioGraphNode,
  endpoint: AudioGraphEndpoint
): AudioNodePortDescriptor | undefined {
  return node.descriptor.ports.find((port) => port.id === endpoint.portId);
}

function missingNodeDiagnostic(
  connection: AudioGraphConnection,
  endpoint: AudioGraphEndpoint
): AudioGraphDiagnostic {
  return {
    severity: 'error',
    code: 'missing-connection-node',
    message: `Connection "${connection.id}" references missing node "${endpoint.nodeId}".`,
    connectionId: connection.id
  };
}

function missingPortDiagnostic(
  connection: AudioGraphConnection,
  endpoint: AudioGraphEndpoint
): AudioGraphDiagnostic {
  return {
    severity: 'error',
    code: 'missing-connection-port',
    message: `Connection "${connection.id}" references missing port "${endpoint.portId}" on node "${endpoint.nodeId}".`,
    connectionId: connection.id,
    nodeId: endpoint.nodeId
  };
}

function resolveExecutionOrder(
  nodes: readonly RuntimeAudioGraphNode[],
  connections: readonly RuntimeAudioGraphConnection[],
  diagnostics: AudioGraphDiagnostic[]
): string[] {
  const nodeIds = new Set(nodes.map((node) => node.node.id));
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const nodeId of nodeIds) {
    incomingCount.set(nodeId, 0);
    outgoing.set(nodeId, []);
  }

  for (const connection of connections) {
    const sourceId = connection.sourceNode.node.id;
    const targetId = connection.targetNode.node.id;

    outgoing.get(sourceId)?.push(targetId);
    incomingCount.set(targetId, (incomingCount.get(targetId) ?? 0) + 1);
  }

  const ready = nodes
    .map((node) => node.node.id)
    .filter((nodeId) => incomingCount.get(nodeId) === 0);
  const order: string[] = [];

  while (ready.length > 0) {
    const nodeId = ready.shift();

    if (!nodeId) continue;

    order.push(nodeId);

    for (const targetId of outgoing.get(nodeId) ?? []) {
      const nextCount = (incomingCount.get(targetId) ?? 0) - 1;
      incomingCount.set(targetId, nextCount);

      if (nextCount === 0) {
        ready.push(targetId);
      }
    }
  }

  if (order.length !== nodes.length) {
    diagnostics.push({
      severity: 'error',
      code: 'graph-cycle',
      message: 'Audio graph contains a cycle and cannot be fully ordered.'
    });

    for (const node of nodes) {
      if (!order.includes(node.node.id)) {
        order.push(node.node.id);
      }
    }
  }

  return order;
}
