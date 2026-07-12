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
  readonly support: NativeProjectSupport
}

export interface NativeProjectSupport {
  readonly supported: boolean
  readonly diagnostics: readonly NativeCompilationDiagnostic[]
}

const graphBuilder = new AudioGraphBuilder(DEFAULT_AUDIO_NODE_DESCRIPTORS)
const supportedNativeDescriptors = new Set([
  'sequencer.source.midi-input',
  'sequencer.source.oscillator',
  'sequencer.processor.gain',
  'sequencer.output.audio-out'
])
const requiredNativeDescriptors = [...supportedNativeDescriptors]
const supportedNativeParameters = new Map<string, ReadonlySet<string>>([
  ['sequencer.source.oscillator', new Set(['waveform'])],
  ['sequencer.processor.gain', new Set(['gain'])]
])

export function compilePlaybackModelToNativePlan(
  playbackModel: PlaybackModel
): NativeProjectCompilation {
  const diagnostics: NativeCompilationDiagnostic[] = []
  const graph = buildRuntimeGraph(playbackModel, diagnostics)
  const nativePlan = createNativeExecutionPlan(graph)
  const plan = {
    ...nativePlan,
    id: `native-plan:${playbackModel.id}`,
    graphId: playbackModel.id,
    revision: computeRevision(playbackModel, graph, diagnostics)
  }
  const support = assessNativeProjectSupport(plan, diagnostics)

  return {
    plan,
    diagnostics,
    support
  }
}

export function assessNativeProjectSupport(
  plan: NativeExecutionPlan,
  existingDiagnostics: readonly NativeCompilationDiagnostic[] = []
): NativeProjectSupport {
  const diagnostics: NativeCompilationDiagnostic[] = []
  const errorDiagnostics = existingDiagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  )

  diagnostics.push(...errorDiagnostics)

  for (const node of plan.nodes) {
    if (!supportedNativeDescriptors.has(node.descriptorId)) {
      diagnostics.push({
        severity: 'error',
        code: nativeUnsupportedNodeCode(node.descriptorId),
        message: `Native playback does not support node "${node.descriptorId}" yet.`,
        nodeId: node.nodeId
      })
    }
  }

  const descriptorCounts = new Map<string, number>()
  for (const node of plan.nodes) {
    descriptorCounts.set(
      node.descriptorId,
      (descriptorCounts.get(node.descriptorId) ?? 0) + 1
    )
  }

  for (const descriptorId of requiredNativeDescriptors) {
    const count = descriptorCounts.get(descriptorId) ?? 0

    if (count === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'missing-native-node',
        message: `Native playback requires one "${descriptorId}" node.`
      })
      continue
    }

    if (count > 1) {
      diagnostics.push({
        severity: 'error',
        code: 'unsupported-native-node-count',
        message: `Native playback currently supports one "${descriptorId}" node, but found ${count}.`
      })
    }
  }

  diagnostics.push(...assessNativeRouting(plan))
  diagnostics.push(...assessNativeParameters(plan))

  return {
    supported: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
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
    playbackModel.tracks.length,
    playbackModel.clips.length,
    playbackModel.notes.length,
    playbackModel.tracks
      .map((track) =>
        [
          track.id,
          track.mixer.volume,
          track.mixer.pan,
          track.deviceInstanceIds?.join(',') ?? track.deviceInstanceId ?? ''
        ].join(':')
      )
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

function assessNativeRouting(
  plan: NativeExecutionPlan
): NativeCompilationDiagnostic[] {
  const diagnostics: NativeCompilationDiagnostic[] = []
  const nodesById = new Map(plan.nodes.map((node) => [node.nodeId, node]))

  for (const route of plan.eventRoutes) {
    const source = nodesById.get(route.sourceNodeId)
    const target = nodesById.get(route.targetNodeId)
    const supported =
      source?.descriptorId === 'sequencer.source.midi-input' &&
      route.sourcePortId === 'midi-out' &&
      target?.descriptorId === 'sequencer.source.oscillator' &&
      route.targetPortId === 'midi-in'

    if (!supported) {
      diagnostics.push({
        severity: 'error',
        code: 'unsupported-native-event-route',
        message: 'Native playback currently supports only MIDI input routed to the native instrument.',
        connectionId: route.id
      })
    }
  }

  const hasRequiredEventRoute = plan.eventRoutes.some((route) => {
    const source = nodesById.get(route.sourceNodeId)
    const target = nodesById.get(route.targetNodeId)

    return (
      source?.descriptorId === 'sequencer.source.midi-input' &&
      route.sourcePortId === 'midi-out' &&
      target?.descriptorId === 'sequencer.source.oscillator' &&
      route.targetPortId === 'midi-in'
    )
  })

  if (!hasRequiredEventRoute) {
    diagnostics.push({
      severity: 'error',
      code: 'missing-native-event-route',
      message: 'Native playback requires MIDI input to be routed to the native instrument.'
    })
  }

  return diagnostics
}

function assessNativeParameters(
  plan: NativeExecutionPlan
): NativeCompilationDiagnostic[] {
  const diagnostics: NativeCompilationDiagnostic[] = []
  const nodesById = new Map(plan.nodes.map((node) => [node.nodeId, node]))

  for (const parameter of plan.parameters) {
    const node = nodesById.get(parameter.nodeId)

    if (!node) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-native-parameter-mapping',
        message: `Native parameter "${parameter.id}" references an unknown node.`,
        nodeId: parameter.nodeId
      })
      continue
    }

    const supportedParameters = supportedNativeParameters.get(node.descriptorId)
    const hasSupportedParameter = supportedParameters?.has(parameter.parameterId) ?? false

    if (hasSupportedParameter && isSupportedNativeParameterValue(parameter.defaultValue)) {
      continue
    }

    diagnostics.push({
      severity: 'error',
      code: 'unsupported-native-parameter',
      message: `Native playback cannot map parameter "${parameter.parameterId}" on "${node.descriptorId}" yet.`,
      nodeId: parameter.nodeId
    })
  }

  return diagnostics
}

function isSupportedNativeParameterValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)

  return typeof value === 'boolean' || typeof value === 'string'
}

function nativeUnsupportedNodeCode(descriptorId: string): string {
  if (descriptorId.includes('sampler') || descriptorId.includes('sample')) {
    return 'unsupported-asset-dependency'
  }

  if (descriptorId.includes('.midi.') || descriptorId.includes('event')) {
    return 'unsupported-event-processor'
  }

  if (descriptorId.includes('processor') || descriptorId.includes('output')) {
    return 'unsupported-audio-node'
  }

  return 'unsupported-device-type'
}
