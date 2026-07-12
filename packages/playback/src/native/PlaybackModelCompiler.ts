import {
  AudioGraphBuilder,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  createNativeExecutionPlan,
  type AudioGraphDocument,
  type NativeExecutionPlan,
  type RuntimeAudioGraph
} from '@sequencer/audio-graph'
import type { PlaybackModel } from '../model.ts'

export interface NativeCompilationDiagnostic {
  readonly severity: 'error' | 'warning'
  readonly code: string
  readonly message: string
  readonly nodeId?: string
  readonly connectionId?: string
}

export interface NativeProjectCompilation {
  readonly plan: NativeExecutionPlan
  readonly diagnostics: readonly NativeCompilationDiagnostic[]
}

const graphBuilder = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS)

export function compilePlaybackModelToNativePlan(
  playbackModel: PlaybackModel
): NativeProjectCompilation {
  const diagnostics: NativeCompilationDiagnostic[] = []
  const graph = buildRuntimeGraph(playbackModel, diagnostics)
  const plan = createNativeExecutionPlan(graph)

  return {
    plan: {
      ...plan,
      id: `native-plan:${playbackModel.id}`,
      graphId: playbackModel.id,
      revision: computeRevision(playbackModel, graph, diagnostics)
    },
    diagnostics
  }
}

function buildRuntimeGraph(
  playbackModel: PlaybackModel,
  diagnostics: NativeCompilationDiagnostic[]
): RuntimeAudioGraph {
  const document = buildRuntimeGraphDocument(playbackModel)
  const graph = graphBuilder.build(document)

  if (playbackModel.tracks.length > 1) {
    diagnostics.push({
      severity: 'error',
      code: 'unsupported-track-count',
      message: 'Native playback currently supports a single track per project.'
    })
  }

  if (playbackModel.clips.length > 1) {
    diagnostics.push({
      severity: 'error',
      code: 'unsupported-clip-count',
      message: 'Native playback currently supports a single clip per project.'
    })
  }

  if (playbackModel.automations.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'unsupported-automation',
      message: 'Automation lanes are not supported by the native plan compiler yet.'
    })
  }

  if (playbackModel.notes.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'empty-project',
      message: 'The project has no notes, so the native plan will be a placeholder graph.'
    })
  }

  if (graph.diagnostics.length > 0) {
    diagnostics.push(
      ...graph.diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        nodeId: diagnostic.nodeId,
        connectionId: diagnostic.connectionId
      }))
    )
  }

  return graph
}

function buildRuntimeGraphDocument(playbackModel: PlaybackModel): AudioGraphDocument {
  const prefix = playbackModel.id.replace(/[^a-zA-Z0-9]+/g, '-') || 'project'

  return {
    id: playbackModel.id,
    version: 1,
    nodes: [
      {
        id: `${prefix}-event-input`,
        descriptorId: 'sequencer.source.midi-input'
      },
      {
        id: `${prefix}-instrument`,
        descriptorId: 'sequencer.source.oscillator'
      },
      {
        id: `${prefix}-gain`,
        descriptorId: 'sequencer.processor.gain',
        parameters: { gain: 0.25 }
      },
      {
        id: `${prefix}-output`,
        descriptorId: 'sequencer.output.audio-out'
      }
    ],
    connections: [
      {
        id: `${prefix}-event-to-instrument`,
        source: { nodeId: `${prefix}-event-input`, portId: 'midi-out' },
        target: { nodeId: `${prefix}-instrument`, portId: 'midi-in' }
      },
      {
        id: `${prefix}-instrument-to-gain`,
        source: { nodeId: `${prefix}-instrument`, portId: 'audio-out' },
        target: { nodeId: `${prefix}-gain`, portId: 'audio-in' }
      },
      {
        id: `${prefix}-gain-to-output`,
        source: { nodeId: `${prefix}-gain`, portId: 'audio-out' },
        target: { nodeId: `${prefix}-output`, portId: 'audio-in' }
      }
    ]
  }
}

function computeRevision(
  playbackModel: PlaybackModel,
  graph: RuntimeAudioGraph,
  diagnostics: readonly NativeCompilationDiagnostic[]
): number {
  const seed = [
    playbackModel.id,
    playbackModel.tempoMap.defaultBpm,
    playbackModel.tracks
      .map((track) => {
        const chain = track.deviceInstanceIds ?? [track.deviceInstanceId].filter(Boolean)
        return `${track.id}:${track.name}:${track.channel}:${chain.join(',')}`
      })
      .join('|'),
    playbackModel.clips
      .map((clip) => `${clip.id}:${clip.trackId}:${clip.length}:${clip.loop}:${clip.loopStart}:${clip.loopLength}`)
      .join('|'),
    playbackModel.notes
      .map((note) => `${note.id}:${note.trackId}:${note.clipId}:${note.pitch}:${note.velocity}:${note.beat}:${note.duration}`)
      .join('|'),
    graph.nodes.map((node) => `${node.descriptorId}:${node.id}`).join('|'),
    diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.severity}`).join('|')
  ].join('|')

  let hash = 5381

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(index)
  }

  return (hash >>> 0) % 10_000 + 1
}
