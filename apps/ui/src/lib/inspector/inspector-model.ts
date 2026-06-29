import {
  getPlacement,
  type DocumentStore,
  type Parameter,
  type ParameterDefinition,
  type ParameterValue
} from '@sequencer/core'

export type InspectorTargetType = 'none' | 'track' | 'placement'

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

export type InspectorView = {
  type: InspectorTargetType
  title: string
  properties: InspectorPropertyView[]
  placement?: PlacementInspectorView
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

  return {
    type: 'none',
    title: 'Unsupported selection',
    properties: []
  }
}
