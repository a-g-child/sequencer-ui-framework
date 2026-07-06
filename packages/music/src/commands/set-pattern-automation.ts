import {
  createId,
  type BeatTime,
  type EntityId,
  type Operation,
  type SequencerDocument,
  type TimelineEvent
} from '@sequencer/core'

export type PatternAutomationPoint = {
  beat: BeatTime
  value: number
}

export class SetPatternAutomationOperation implements Operation {
  readonly name = 'Set Pattern Automation'

  private previousEvents: TimelineEvent[] = []

  constructor(
    private readonly patternId: EntityId,
    private readonly parameterId: EntityId,
    private readonly points: readonly PatternAutomationPoint[]
  ) {}

  execute(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    this.previousEvents = pattern.events.map((event) => ({ ...event }))
    pattern.events = [
      ...pattern.events.filter(
        (event) => !isAutomationEventForParameter(event, this.parameterId)
      ),
      ...this.points
        .filter((point) => Number.isFinite(point.beat) && Number.isFinite(point.value))
        .map((point): TimelineEvent<number> => ({
          id: createId('automation'),
          time: Math.max(0, point.beat),
          target: this.parameterId,
          type: 'set',
          value: point.value
        }))
    ].sort((left, right) => left.time - right.time)
  }

  undo(document: SequencerDocument): void {
    const pattern = document.patterns.get(this.patternId)

    pattern.events = this.previousEvents.map((event) => ({ ...event }))
  }
}

function isAutomationEventForParameter(
  event: TimelineEvent,
  parameterId: EntityId
): boolean {
  return event.target === parameterId && (event.type === 'set' || event.type === 'ramp')
}
