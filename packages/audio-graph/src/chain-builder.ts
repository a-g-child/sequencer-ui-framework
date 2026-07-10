import type {
  AudioGraphConnection,
  AudioGraphDocument,
  AudioGraphEndpoint,
  AudioGraphNode
} from './types.ts';

export interface DeviceGraphFragment {
  readonly id: string;
  readonly name?: string;
  readonly graph: AudioGraphDocument;
}

export interface DeviceChainGraphOptions {
  readonly id: string;
  readonly name?: string;
  readonly fragments: readonly DeviceGraphFragment[];
}

const CLIP_NOTES_DESCRIPTOR_ID = 'sequencer.source.clip-notes';
const MIDI_INPUT_DESCRIPTOR_ID = 'sequencer.source.midi-input';
const MIDI_OUTPUT_DESCRIPTOR_ID = 'sequencer.output.midi-out';
const AUDIO_INPUT_DESCRIPTOR_ID = 'sequencer.source.audio-input';
const AUDIO_OUTPUT_DESCRIPTOR_ID = 'sequencer.output.audio-out';

export function buildDeviceChainGraph(
  options: DeviceChainGraphOptions
): AudioGraphDocument {
  const nodes: AudioGraphNode[] = [
    {
      id: 'track-midi-in',
      descriptorId: CLIP_NOTES_DESCRIPTOR_ID,
      name: 'Track MIDI',
      position: { x: 0, y: 0 }
    }
  ];
  const connections: AudioGraphConnection[] = [];
  let currentMidiSources: readonly AudioGraphEndpoint[] = [
    { nodeId: 'track-midi-in', portId: 'midi-out' }
  ];
  let currentAudioSources: readonly AudioGraphEndpoint[] = [];

  options.fragments.forEach((fragment, fragmentIndex) => {
    const prepared = prepareFragment(fragment, fragmentIndex);

    nodes.push(...prepared.nodes);
    connections.push(...prepared.connections);

    if (prepared.midiInputs.length > 0 && currentMidiSources.length > 0) {
      connections.push(
        ...connectEndpoints({
          idPrefix: `${prepared.prefix}:midi-in`,
          sources: currentMidiSources,
          targets: prepared.midiInputs
        })
      );
    }

    if (prepared.midiOutputs.length > 0) {
      currentMidiSources = prepared.midiOutputs;
    }

    if (prepared.audioInputs.length > 0 && currentAudioSources.length > 0) {
      connections.push(
        ...connectEndpoints({
          idPrefix: `${prepared.prefix}:audio-in`,
          sources: currentAudioSources,
          targets: prepared.audioInputs
        })
      );
    }

    if (prepared.audioOutputs.length > 0) {
      currentAudioSources = prepared.audioOutputs;
    }
  });

  nodes.push({
    id: 'track-audio-out',
    descriptorId: AUDIO_OUTPUT_DESCRIPTOR_ID,
    name: 'Track Audio Out',
    position: { x: (options.fragments.length + 1) * 440, y: 0 }
  });

  connections.push(
    ...connectEndpoints({
      idPrefix: 'track:audio-out',
      sources: currentAudioSources,
      targets: [{ nodeId: 'track-audio-out', portId: 'audio-in' }]
    })
  );

  return {
    id: options.id,
    version: 1,
    metadata: {
      name: options.name ?? options.id,
      description: 'Composed graph for a device chain.'
    },
    nodes,
    connections
  };
}

interface PreparedGraphFragment {
  readonly prefix: string;
  readonly nodes: readonly AudioGraphNode[];
  readonly connections: readonly AudioGraphConnection[];
  readonly midiInputs: readonly AudioGraphEndpoint[];
  readonly midiOutputs: readonly AudioGraphEndpoint[];
  readonly audioInputs: readonly AudioGraphEndpoint[];
  readonly audioOutputs: readonly AudioGraphEndpoint[];
}

function prepareFragment(
  fragment: DeviceGraphFragment,
  fragmentIndex: number
): PreparedGraphFragment {
  const prefix = safeGraphId(fragment.id || `device-${fragmentIndex}`);
  const boundaryNodeIds = new Set(
    fragment.graph.nodes
      .filter(isBoundaryNode)
      .map((node) => node.id)
  );
  const boundaryDescriptorIdsByNodeId = new Map(
    fragment.graph.nodes.map((node) => [node.id, node.descriptorId])
  );
  const nodes = fragment.graph.nodes
    .filter((node) => !boundaryNodeIds.has(node.id))
    .map((node) => prefixNode(node, prefix, fragmentIndex));
  const connections = fragment.graph.connections
    .filter(
      (connection) =>
        !boundaryNodeIds.has(connection.source.nodeId) &&
        !boundaryNodeIds.has(connection.target.nodeId)
    )
    .map((connection) => prefixConnection(connection, prefix));

  return {
    prefix,
    nodes,
    connections,
    midiInputs: collectBoundaryTargets({
      graph: fragment.graph,
      boundaryDescriptorIdsByNodeId,
      boundaryDescriptorIds: [CLIP_NOTES_DESCRIPTOR_ID, MIDI_INPUT_DESCRIPTOR_ID],
      sourcePortId: 'midi-out',
      prefix
    }),
    midiOutputs: collectBoundarySources({
      graph: fragment.graph,
      boundaryDescriptorIdsByNodeId,
      boundaryDescriptorIds: [MIDI_OUTPUT_DESCRIPTOR_ID],
      targetPortId: 'midi-in',
      prefix
    }),
    audioInputs: collectBoundaryTargets({
      graph: fragment.graph,
      boundaryDescriptorIdsByNodeId,
      boundaryDescriptorIds: [AUDIO_INPUT_DESCRIPTOR_ID],
      sourcePortId: 'audio-out',
      prefix
    }),
    audioOutputs: collectBoundarySources({
      graph: fragment.graph,
      boundaryDescriptorIdsByNodeId,
      boundaryDescriptorIds: [AUDIO_OUTPUT_DESCRIPTOR_ID],
      targetPortId: 'audio-in',
      prefix
    })
  };
}

function isBoundaryNode(node: AudioGraphNode): boolean {
  return (
    node.descriptorId === CLIP_NOTES_DESCRIPTOR_ID ||
    node.descriptorId === MIDI_INPUT_DESCRIPTOR_ID ||
    node.descriptorId === MIDI_OUTPUT_DESCRIPTOR_ID ||
    node.descriptorId === AUDIO_INPUT_DESCRIPTOR_ID ||
    node.descriptorId === AUDIO_OUTPUT_DESCRIPTOR_ID
  );
}

function prefixNode(
  node: AudioGraphNode,
  prefix: string,
  fragmentIndex: number
): AudioGraphNode {
  return {
    ...node,
    id: prefixEndpoint(node.id, prefix),
    name: node.name ? `${node.name}` : undefined,
    position: node.position
      ? {
          x: node.position.x + (fragmentIndex + 1) * 440,
          y: node.position.y
        }
      : undefined
  };
}

function prefixConnection(
  connection: AudioGraphConnection,
  prefix: string
): AudioGraphConnection {
  return {
    ...connection,
    id: prefixEndpoint(connection.id, prefix),
    source: prefixGraphEndpoint(connection.source, prefix),
    target: prefixGraphEndpoint(connection.target, prefix)
  };
}

function collectBoundaryTargets(options: {
  readonly graph: AudioGraphDocument;
  readonly boundaryDescriptorIdsByNodeId: ReadonlyMap<string, string>;
  readonly boundaryDescriptorIds: readonly string[];
  readonly sourcePortId: string;
  readonly prefix: string;
}): readonly AudioGraphEndpoint[] {
  return options.graph.connections
    .filter(
      (connection) =>
        options.boundaryDescriptorIds.includes(
          options.boundaryDescriptorIdsByNodeId.get(connection.source.nodeId) ?? ''
        ) && connection.source.portId === options.sourcePortId
    )
    .map((connection) => prefixGraphEndpoint(connection.target, options.prefix));
}

function collectBoundarySources(options: {
  readonly graph: AudioGraphDocument;
  readonly boundaryDescriptorIdsByNodeId: ReadonlyMap<string, string>;
  readonly boundaryDescriptorIds: readonly string[];
  readonly targetPortId: string;
  readonly prefix: string;
}): readonly AudioGraphEndpoint[] {
  return options.graph.connections
    .filter(
      (connection) =>
        options.boundaryDescriptorIds.includes(
          options.boundaryDescriptorIdsByNodeId.get(connection.target.nodeId) ?? ''
        ) && connection.target.portId === options.targetPortId
    )
    .map((connection) => prefixGraphEndpoint(connection.source, options.prefix));
}

function connectEndpoints(options: {
  readonly idPrefix: string;
  readonly sources: readonly AudioGraphEndpoint[];
  readonly targets: readonly AudioGraphEndpoint[];
}): AudioGraphConnection[] {
  const connections: AudioGraphConnection[] = [];

  options.sources.forEach((source, sourceIndex) => {
    options.targets.forEach((target, targetIndex) => {
      connections.push({
        id: `${options.idPrefix}:${sourceIndex}-${targetIndex}`,
        source,
        target
      });
    });
  });

  return connections;
}

function prefixGraphEndpoint(
  endpoint: AudioGraphEndpoint,
  prefix: string
): AudioGraphEndpoint {
  return {
    nodeId: prefixEndpoint(endpoint.nodeId, prefix),
    portId: endpoint.portId
  };
}

function prefixEndpoint(id: string, prefix: string): string {
  return `${prefix}.${id}`;
}

function safeGraphId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}
