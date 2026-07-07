import {
  VoiceManager,
  type AdsrEnvelope,
  type VoiceAction
} from '@sequencer/audio';
import { BASIC_SYNTH_DESCRIPTOR } from '../descriptors/basic-synth';
import type { DeviceFactory } from '../factory';
import type { DeviceInstance } from '../instance';
import {
  advanceRuntimeParameters,
  createRuntimeParameters,
  getRuntimeParameter,
  getRuntimeParameterValue,
  setRuntimeParameterValue
} from '../parameter-runtime';
import { BaseRuntimeDevice } from '../runtime';

export class BasicSynthRuntimeDevice<
  TEvent = unknown
> extends BaseRuntimeDevice<TEvent> {
  readonly voices = new VoiceManager(8);

  private pendingVoiceActions: VoiceAction[] = [];

  get waveform(): string {
    const value = getRuntimeParameterValue(this.parameters, 'waveform');

    return typeof value === 'string' ? value : 'sine';
  }

  get volume(): number {
    const value = getRuntimeParameterValue(this.parameters, 'volume');

    return typeof value === 'number' ? value : 0.25;
  }

  processEvents(events: readonly TEvent[]): void {
    this.pendingVoiceActions = [];

    for (const event of events) {
      if (isNoteOnEvent(event)) {
        const result = this.voices.startVoiceWithStealing({
          noteId: event.noteId,
          trackId: event.destination?.trackId,
          pitch: event.pitch,
          velocity: event.velocity,
          nowMs: event.timeMs
        });

        if (result.stolenVoice) {
          this.pendingVoiceActions.push({
            type: 'voice:steal',
            voiceId: result.stolenVoice.id,
            timeMs: event.timeMs
          });
        }

        this.pendingVoiceActions.push({
          type: 'voice:start',
          voiceId: result.voice.id,
          trackId: result.voice.trackId,
          noteId: result.voice.noteId,
          pitch: result.voice.pitch,
          velocity: result.voice.velocity,
          timeMs: event.timeMs,
          envelope: this.getEnvelope()
        });

        continue;
      }

      if (isNoteOffEvent(event)) {
        const releasedVoices = this.voices.releaseVoiceByNote(
          event.noteId,
          event.timeMs
        );

        for (const voice of releasedVoices) {
          this.pendingVoiceActions.push({
            type: 'voice:release',
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

  advance(deltaMs: number): void {
    advanceRuntimeParameters(this.parameters, deltaMs);
  }

  getDiagnostics(): { voices: ReturnType<VoiceManager['stats']> } {
    return {
      voices: this.voices.stats()
    };
  }

  private getEnvelope(): AdsrEnvelope {
    return {
      attack: numberParameter(this.parameters, 'attack', 0.01),
      decay: numberParameter(this.parameters, 'decay', 0.15),
      sustain: numberParameter(this.parameters, 'sustain', 0.7),
      release: numberParameter(this.parameters, 'release', 0.2)
    };
  }

  consumeVoiceActions(): VoiceAction[] {
    const actions = this.pendingVoiceActions;
    this.pendingVoiceActions = [];
    return actions;
  }
}

function numberParameter(
  parameters: BasicSynthRuntimeDevice['parameters'],
  key: string,
  fallback: number
): number {
  const value = getRuntimeParameterValue(parameters, key);
  const numberValue = Number(value ?? fallback);

  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export class BasicSynthFactory<TEvent = unknown>
  implements DeviceFactory<TEvent>
{
  readonly descriptor = BASIC_SYNTH_DESCRIPTOR;

  create(instance: DeviceInstance): BasicSynthRuntimeDevice<TEvent> {
    return new BasicSynthRuntimeDevice(
      instance,
      createRuntimeParameters(this.descriptor, instance)
    );
  }
}

function isParameterEvent(
  event: unknown
): event is { readonly parameterKey: string; readonly value: number } {
  return (
    typeof event === 'object' &&
    event !== null &&
    'parameterKey' in event &&
    'value' in event &&
    typeof event.parameterKey === 'string' &&
    typeof event.value === 'number'
  );
}

function isNoteOnEvent(event: unknown): event is {
  readonly type: 'note:on';
  readonly noteId: string;
  readonly destination?: { readonly trackId?: string };
  readonly pitch: number;
  readonly velocity: number;
  readonly timeMs: number;
} {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    event.type === 'note:on' &&
    'noteId' in event &&
    typeof event.noteId === 'string' &&
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
