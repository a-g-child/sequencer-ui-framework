import {
  getPlacement,
  type DocumentStore,
  type Parameter,
  type ParameterDefinition,
  type ParameterValue
} from '@sequencer/core'
import { getNote, getTimingOffset } from '@sequencer/music'
import type { PatternScaleState } from '../music/pattern/pattern-scale'

export type InspectorTargetType = 'none' | 'track' | 'placement' | 'note' | 'clip'

export type InspectorPropertyView = {
  parameter: Parameter
  definition: ParameterDefinition
  value: ParameterValue
}

export type PlacementInspectorView = {
  id: string
  trackId: string
  start: number
  length: number
  loopCount: number
  targetPatternId: string
  targetPatternName: string
}

export type NoteInspectorView = {
  id: string
  patternId: string
  time: number
  duration: number
  pitch: number
  velocity: number
  probability: number
  humanizeOffset: number
}

export type ClipInspectorView = {
  id: string
  name: string
  trackId: string
  trackName: string
  volume: number
  pan: number
  muted: boolean
  soloed: boolean
  armed: boolean
  pending: boolean
  clipStart: number
  clipEnd: number
  loopEnabled: boolean
  loopStart: number
  loopEnd: number
  beatDivisions: number
  launchQuantize: string
  launchQuantizeLabel: string
  selectedNoteCount: number
  velocityLaneVisible: boolean
  probabilityLaneVisible: boolean
  automationLaneVisible: boolean
  automationTargetCount: number
  scale?: PatternScaleState
}

export type GraphDiagnosticMessageView = {
  severity: string
  code: string
  message: string
}

export type GraphDiagnosticsView = {
  deviceName: string
  presetId: string
  nodeCount: number
  connectionCount: number
  latencySamples: number
  executionOrder: string[]
  nodeDiagnostics: RuntimeNodeDiagnosticsView[]
  validationMessages: GraphDiagnosticMessageView[]
}

export type RuntimeNodeDiagnosticsView = {
  nodeId: string
  descriptorId: string
  executionIndex: number
  lastProcessMs?: number
  averageProcessMs?: number
  peakProcessMs?: number
  latencySamples?: number
}

export type InspectorView = {
  type: InspectorTargetType
  title: string
  properties: InspectorPropertyView[]
  graph?: GraphDiagnosticsView
  placement?: PlacementInspectorView
  note?: NoteInspectorView
  clip?: ClipInspectorView
}

export function buildInspectorView(store: DocumentStore): InspectorView {
  const selection = store.selection.current()

  if (!selection) {
    return {
      type: 'none',
      title: 'Nothing selected',
      properties: []
    }
  }

  if (selection.type === 'track') {
    const track = store.document.tracks.find(selection.id)

    if (!track) {
      return {
        type: 'none',
        title: 'Missing track',
        properties: []
      }
    }

    return {
      type: 'track',
      title: track.name,
      properties: track.parameters.map((parameterId) => {
        const parameter = store.document.parameters.get(parameterId)
        const definition = store.document.parameterDefinitions.get(
          parameter.definitionId
        )

        return {
          parameter,
          definition,
          value: parameter.value
        }
      })
    }
  }

  if (selection.type === 'placement' && selection.parentId) {
    const placement = getPlacement(
      store.document,
      selection.parentId,
      selection.id
    )
    const pattern = store.document.patterns.get(placement.target)

    return {
      type: 'placement',
      title: placement.name,
      properties: [],
      placement: {
        id: placement.id,
        trackId: selection.parentId,
        start: placement.start,
        length: placement.length ?? pattern.length,
        loopCount: placement.loopCount ?? 1,
        targetPatternId: pattern.id,
        targetPatternName: pattern.name
      }
    }
  }

  if (selection.type === 'note' && selection.parentId) {
    const note = getNote(store.document, selection.parentId, selection.id)

    return {
      type: 'note',
      title: 'Note',
      properties: [],
      note: {
        id: note.id,
        patternId: selection.parentId,
        time: note.time,
        duration: note.duration,
        pitch: note.value.pitch,
        velocity: note.value.velocity,
        probability: note.value.probability ?? 1,
        humanizeOffset: getTimingOffset(note.value)
      }
    }
  }

  return {
    type: 'none',
    title: 'Unsupported selection',
    properties: []
  }
}
