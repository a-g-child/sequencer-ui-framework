import {
  AudioGraphBuilder,
  DEFAULT_AUDIO_NODE_DESCRIPTORS,
  SAMPLER_AUDIO_GRAPH,
  type RuntimeAudioGraph
} from '@sequencer/audio-graph';
import { VoiceManager, type SampleVoiceAction } from '@sequencer/audio';
import { SAMPLER_DESCRIPTOR } from '../descriptors/sampler.ts';
import type { DeviceFactory } from '../factory.ts';
import type { DeviceInstance } from '../instance.ts';
import {
  createRuntimeParameters,
  getRuntimeParameterEffectiveValue,
  getRuntimeParameter,
  setRuntimeParameterValue
} from '../parameter-runtime.ts';
import { BaseRuntimeDevice } from '../runtime.ts';
import type { SampleSlot, SamplerMode } from '../sampler.ts';

const samplerGraphBuilder = new AudioGraphBuilder(
  DEFAULT_AUDIO_NODE_DESCRIPTORS
);

export type SamplerDeviceInstance = DeviceInstance & {
  descriptorKey: 'sampler';
  sampleSlots?: SampleSlot[];
};

export type SamplerDiagnostics = {
  readonly triggeredSamples: number;
  readonly missingSamples: number;
  readonly lastTriggeredSlot?: string;
  readonly graph?: SamplerGraphDiagnostics;
};

export type SamplerGraphDiagnostics = {
  readonly presetId: string;
  readonly nodeCount: number;
  readonly connectionCount: number;
  readonly latencySamples: number;
  readonly executionOrder: readonly string[];
  readonly diagnostics: RuntimeAudioGraph['diagnostics'];
};

export class SamplerRuntimeDevice<
  TEvent = unknown
> extends BaseRuntimeDevice<TEvent> {
  readonly voices = new VoiceManager(16);

  private pendingSampleActions: SampleVoiceAction[] = [];
  private triggeredSamples = 0;
  private missingSamples = 0;
  private lastTriggeredSlot?: string;

  constructor(
    instance: DeviceInstance,
    parameters = createRuntimeParameters(SAMPLER_DESCRIPTOR, instance),
    runtimeGraph = samplerGraphBuilder.build(SAMPLER_AUDIO_GRAPH)
  ) {
    super(instance, parameters, runtimeGraph);
  }

  get sampleSlots(): readonly SampleSlot[] {
    return isSamplerDeviceInstance(this.instance)
      ? this.instance.sampleSlots ?? []
      : [];
  }

  get mode(): SamplerMode {
    const value = getRuntimeParameterEffectiveValue(this.parameters, 'mode');

    return value === 'multi' ? 'multi' : 'pitched';
  }

  processEvents(events: readonly TEvent[]): void {
    this.pendingSampleActions = [];

    for (const event of events) {
      if (isNoteOnEvent(event)) {
        this.triggerSampleForNote(event);
        continue;
      }

      if (isNoteOffEvent(event)) {
        const releasedVoices = this.voices.releaseVoiceByNote(
          event.noteId,
          event.timeMs
        );

        for (const voice of releasedVoices) {
          this.pendingSampleActions.push({
            type: 'sample:release',
            voiceId: voice.id,
            timeMs: event.timeMs
          });
        }

        continue;
      }

      if (!isParameterEvent(event)) continue;

      const parameter = getRuntimeParameter(this.parameters, event.parameterKey);

      if (parameter) {
        setRuntimeParameterValue(parameter, event.value);
      }
    }
  }

  resolveSlotForNote(pitch: number): SampleSlot | undefined {
    const slots = this.sampleSlots;

    if (slots.length === 0 || !Number.isFinite(pitch)) {
      return undefined;
    }

    if (this.mode === 'multi') {
      return slots.find((slot) => slot.rootNote === pitch);
    }

    return [...slots].sort(
      (left, right) =>
        Math.abs(left.rootNote - pitch) - Math.abs(right.rootNote - pitch)
    )[0];
  }

  getDiagnostics(): SamplerDiagnostics {
    return {
      triggeredSamples: this.triggeredSamples,
      missingSamples: this.missingSamples,
      lastTriggeredSlot: this.lastTriggeredSlot,
      graph: this.runtimeGraph
        ? {
            presetId: this.runtimeGraph.document.id,
            nodeCount: this.runtimeGraph.nodes.length,
            connectionCount: this.runtimeGraph.connections.length,
            latencySamples: this.runtimeGraph.latencySamples,
            executionOrder: this.runtimeGraph.executionOrder,
            diagnostics: this.runtimeGraph.diagnostics
          }
        : undefined
    };
  }

  consumeSampleActions(): SampleVoiceAction[] {
    const actions = this.pendingSampleActions;
    this.pendingSampleActions = [];
    return actions;
  }

  panic(): void {
    this.pendingSampleActions = [];
    this.voices.clear();
  }

  private triggerSampleForNote(event: NoteOnLike): void {
    const slot = this.resolveSlotForNote(event.pitch);
    this.lastTriggeredSlot = slot?.id;

    if (!slot?.assetId) {
      this.missingSamples += 1;
      return;
    }

    const result = this.voices.startVoiceWithStealing({
      noteId: event.noteId,
      trackId: event.destination?.trackId,
      pitch: event.pitch,
      velocity: event.velocity,
      nowMs: event.timeMs
    });

    if (result.stolenVoice) {
      this.pendingSampleActions.push({
        type: 'sample:release',
        voiceId: result.stolenVoice.id,
        timeMs: event.timeMs
      });
    }

    this.triggeredSamples += 1;
    this.pendingSampleActions.push({
      type: 'sample:start',
      voiceId: result.voice.id,
      trackId: result.voice.trackId,
      noteId: result.voice.noteId,
      assetId: slot.assetId,
      pitch: result.voice.pitch,
      velocity: result.voice.velocity,
      playbackRate: playbackRateForSlot(slot, result.voice.pitch, this.mode),
      gain: sampleGain(slot, result.voice.velocity, this.volume),
      startSeconds: Math.max(0, slot.start),
      endSeconds: slot.end === undefined ? undefined : Math.max(0, slot.end),
      loopEnabled: slot.loop,
      loopStartSeconds: Math.max(0, slot.loopStart ?? slot.start),
      loopEndSeconds:
        slot.loopEnd === undefined
          ? slot.end === undefined
            ? undefined
            : Math.max(0, slot.end)
          : Math.max(0, slot.loopEnd),
      timeMs: event.timeMs
    });
  }

  private get volume(): number {
    const value = getRuntimeParameterEffectiveValue(this.parameters, 'volume');
    const volume = Number(value ?? 0.8);

    return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8;
  }
}

export class SamplerFactory<TEvent = unknown>
  implements DeviceFactory<TEvent>
{
  readonly descriptor = SAMPLER_DESCRIPTOR;

  create(instance: DeviceInstance): SamplerRuntimeDevice<TEvent> {
    return new SamplerRuntimeDevice(
      instance,
      createRuntimeParameters(this.descriptor, instance),
      samplerGraphBuilder.build(SAMPLER_AUDIO_GRAPH)
    );
  }
}

function isSamplerDeviceInstance(
  instance: DeviceInstance
): instance is SamplerDeviceInstance {
  return instance.descriptorKey === SAMPLER_DESCRIPTOR.key;
}

function isParameterEvent(
  event: unknown
): event is { readonly parameterKey: string; readonly value: number | string } {
  return (
    typeof event === 'object' &&
    event !== null &&
    'parameterKey' in event &&
    'value' in event &&
    typeof event.parameterKey === 'string' &&
    (typeof event.value === 'number' || typeof event.value === 'string')
  );
}

type NoteOnLike = {
  readonly type: 'note:on';
  readonly noteId?: string;
  readonly destination?: { readonly trackId?: string };
  readonly pitch: number;
  readonly velocity: number;
  readonly timeMs: number;
};

function isNoteOnEvent(event: unknown): event is NoteOnLike {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    event.type === 'note:on' &&
    'pitch' in event &&
    typeof event.pitch === 'number' &&
    'velocity' in event &&
    typeof event.velocity === 'number' &&
    'timeMs' in event &&
    typeof event.timeMs === 'number'
  );
}

function isNoteOffEvent(event: unknown): event is {
  readonly type: 'note:off';
  readonly noteId: string;
  readonly timeMs: number;
} {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    event.type === 'note:off' &&
    'noteId' in event &&
    typeof event.noteId === 'string' &&
    'timeMs' in event &&
    typeof event.timeMs === 'number'
  );
}

function playbackRateForSlot(
  slot: SampleSlot,
  pitch: number,
  mode: SamplerMode
): number {
  if (mode === 'multi') return 1;

  return 2 ** ((pitch - slot.rootNote) / 12);
}

function sampleGain(slot: SampleSlot, velocity: number, volume: number): number {
  const slotGain = Number.isFinite(slot.gain) ? slot.gain : 1;
  const normalizedVelocity = Number.isFinite(velocity)
    ? Math.min(1, Math.max(0, velocity))
    : 0;

  return Math.max(0, slotGain) * normalizedVelocity * volume;
}
