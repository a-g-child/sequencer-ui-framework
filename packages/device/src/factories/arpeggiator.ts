import {
  ARPEGGIATOR_MIDI_GRAPH,
  AudioGraphBuilder,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  type RuntimeAudioGraph
} from '@sequencer/audio-graph';
import { ARPEGGIATOR_DESCRIPTOR } from '../descriptors/arpeggiator.ts';
import type { DeviceFactory } from '../factory.ts';
import type { DeviceInstance } from '../instance.ts';
import {
  createRuntimeParameters,
  getRuntimeParameterEffectiveValue
} from '../parameter-runtime.ts';
import { BaseRuntimeDevice } from '../runtime.ts';

const arpeggiatorGraphBuilder = new AudioGraphBuilder(
  DEFAULT_AUDIO_NODE_DESCRIPTORS
);

export interface ArpeggiatorGraphDiagnostics {
  readonly presetId: string;
  readonly nodeCount: number;
  readonly connectionCount: number;
  readonly latencySamples: number;
  readonly executionOrder: readonly string[];
  readonly diagnostics: RuntimeAudioGraph['diagnostics'];
  readonly nodeDiagnostics: RuntimeAudioGraph['nodeDiagnostics'];
}

export interface ArpeggiatorDiagnostics {
  readonly transformedEvents: number;
  readonly graph?: ArpeggiatorGraphDiagnostics;
}

export class ArpeggiatorRuntimeDevice<
  TEvent = unknown
> extends BaseRuntimeDevice<TEvent> {
  private pendingEvents: TEvent[] = [];
  private transformedEvents = 0;

  processEvents(events: readonly TEvent[]): void {
    this.pendingEvents = [];
    const noteOnGroups = groupNoteOnEvents(events);

    for (const group of noteOnGroups) {
      const generatedEvents = this.arpeggiate(group);

      this.pendingEvents.push(...generatedEvents);
      this.transformedEvents += generatedEvents.length;
    }

    for (const event of events) {
      if (isNoteEvent(event)) {
        continue;
      }

      this.pendingEvents.push(event);
    }
  }

  consumePlaybackEvents(): TEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  getDiagnostics(): ArpeggiatorDiagnostics {
    return {
      transformedEvents: this.transformedEvents,
      graph: this.runtimeGraph
        ? {
            presetId: this.runtimeGraph.document.id,
            nodeCount: this.runtimeGraph.nodes.length,
            connectionCount: this.runtimeGraph.connections.length,
            latencySamples: this.runtimeGraph.latencySamples,
            executionOrder: this.runtimeGraph.executionOrder,
            diagnostics: this.runtimeGraph.diagnostics,
            nodeDiagnostics: this.runtimeGraph.nodeDiagnostics
          }
        : undefined
    };
  }

  panic(): void {
    this.pendingEvents = [];
  }

  private arpeggiate(events: readonly NoteOnEvent[]): TEvent[] {
    if (events.length === 0) return [];

    const firstEvent = events[0];
    const octaveRange = Math.max(
      1,
      Math.min(4, Math.round(numberParameter(this.parameters, 'octaveRange', 1)))
    );
    const stepBeats = rateToBeats(
      stringParameter(this.parameters, 'rate', '1/16')
    );
    const durationBeats = Math.max(
      stepBeats,
      ...events.map((event) => numberOrFallback(event.duration, stepBeats))
    );
    const durationMs = Math.max(
      1,
      ...events.map((event) => numberOrFallback(event.durationMs, 0))
    );
    const msPerBeat = durationMs / durationBeats;
    const sequence = buildPitchSequence(events, octaveRange);
    const generatedEvents: TEvent[] = [];

    if (sequence.length === 0) return generatedEvents;

    const stepCount = Math.max(1, Math.ceil(durationBeats / stepBeats));

    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      const pitch = sequence[stepIndex % sequence.length];
      const offsetBeats = stepIndex * stepBeats;

      if (offsetBeats >= durationBeats) break;

      const noteDurationBeats = Math.min(
        stepBeats * 0.8,
        durationBeats - offsetBeats
      );
      const noteId = `${firstEvent.noteId}:arp-${stepIndex}`;
      const beat = numberOrFallback(firstEvent.beat, 0) + offsetBeats;
      const timeMs =
        numberOrFallback(firstEvent.timeMs, 0) + offsetBeats * msPerBeat;
      const offBeat = beat + noteDurationBeats;
      const offTimeMs = timeMs + noteDurationBeats * msPerBeat;

      generatedEvents.push({
        ...firstEvent,
        id: `${firstEvent.id}:arp-${stepIndex}:on`,
        type: 'note:on',
        noteId,
        pitch,
        beat,
        timeMs,
        duration: noteDurationBeats,
        durationMs: noteDurationBeats * msPerBeat
      } as TEvent);
      generatedEvents.push({
        ...firstEvent,
        id: `${firstEvent.id}:arp-${stepIndex}:off`,
        type: 'note:off',
        noteId,
        pitch,
        velocity: 0,
        beat: offBeat,
        timeMs: offTimeMs
      } as TEvent);
    }

    return generatedEvents;
  }
}

export class ArpeggiatorFactory<TEvent = unknown>
  implements DeviceFactory<TEvent>
{
  readonly descriptor = ARPEGGIATOR_DESCRIPTOR;

  create(instance: DeviceInstance): ArpeggiatorRuntimeDevice<TEvent> {
    return new ArpeggiatorRuntimeDevice(
      instance,
      createRuntimeParameters(this.descriptor, instance),
      arpeggiatorGraphBuilder.build(ARPEGGIATOR_MIDI_GRAPH)
    );
  }
}

type NoteEvent = {
  readonly id: string;
  readonly noteId: string;
  readonly pitch: number;
  readonly trackId?: string;
  readonly channel?: number;
  readonly beat?: number;
  readonly timeMs?: number;
  readonly duration?: number;
  readonly durationMs?: number;
};

type NoteOnEvent = NoteEvent & {
  readonly type: 'note:on';
  readonly velocity?: number;
};

function numberParameter(
  parameters: ArpeggiatorRuntimeDevice['parameters'],
  key: string,
  fallback: number
): number {
  const value = getRuntimeParameterEffectiveValue(parameters, key);
  const numberValue = Number(value ?? fallback);

  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function stringParameter(
  parameters: ArpeggiatorRuntimeDevice['parameters'],
  key: string,
  fallback: string
): string {
  const value = getRuntimeParameterEffectiveValue(parameters, key);

  return typeof value === 'string' ? value : fallback;
}

function rateToBeats(rate: string): number {
  switch (rate) {
    case '1/8':
      return 1 / 2;
    case '1/32':
      return 1 / 8;
    case '1/16':
    default:
      return 1 / 4;
  }
}

function groupNoteOnEvents<TEvent>(
  events: readonly TEvent[]
): readonly (readonly NoteOnEvent[])[] {
  const groups: NoteOnEvent[][] = [];
  const groupsByBeat = new Map<string, NoteOnEvent[]>();

  for (const event of events) {
    if (!isNoteOnEvent(event)) continue;

    const groupKey = [
      numberOrFallback(event.beat, 0),
      numberOrFallback(event.timeMs, 0),
      event.trackId ?? '',
      event.channel ?? ''
    ].join(':');
    const existingGroup = groupsByBeat.get(groupKey);

    if (existingGroup) {
      existingGroup.push(event);
      continue;
    }

    const group = [event];

    groupsByBeat.set(groupKey, group);
    groups.push(group);
  }

  return groups;
}

function buildPitchSequence(
  events: readonly NoteOnEvent[],
  octaveRange: number
): readonly number[] {
  const sourcePitches = [...new Set(events.map((event) => event.pitch))]
    .sort((left, right) => left - right);
  const pitches: number[] = [];

  for (let octaveIndex = 0; octaveIndex < octaveRange; octaveIndex += 1) {
    for (const pitch of sourcePitches) {
      const transposedPitch = pitch + octaveIndex * 12;

      if (transposedPitch >= 0 && transposedPitch <= 127) {
        pitches.push(transposedPitch);
      }
    }
  }

  return pitches;
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isNoteOnEvent(event: unknown): event is NoteOnEvent {
  return isNoteEvent(event) && event.type === 'note:on';
}

function isNoteEvent(event: unknown): event is NoteEvent & {
  readonly type: string;
  readonly trackId?: string;
  readonly channel?: number;
} {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    typeof event.type === 'string' &&
    'id' in event &&
    typeof event.id === 'string' &&
    'noteId' in event &&
    typeof event.noteId === 'string' &&
    'pitch' in event &&
    typeof event.pitch === 'number'
  );
}
