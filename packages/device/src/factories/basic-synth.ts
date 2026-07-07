import {
  VoiceManager,
  type AdsrEnvelope,
  type Glide,
  type VoiceAction
} from '@sequencer/audio';
import { BASIC_SYNTH_DESCRIPTOR } from '../descriptors/basic-synth';
import type { DeviceFactory } from '../factory';
import type { DeviceInstance } from '../instance';
import {
  advanceRuntimeParameters,
  createRuntimeParameters,
  getRuntimeParameter,
  getRuntimeParameterEffectiveValue,
  setRuntimeParameterModulation,
  setRuntimeParameterValue
} from '../parameter-runtime';
import { BaseRuntimeDevice } from '../runtime';

export class BasicSynthRuntimeDevice<
  TEvent = unknown
> extends BaseRuntimeDevice<TEvent> {
  readonly voices = new VoiceManager(8);

  private pendingVoiceActions: VoiceAction[] = [];
  private lfoPhase = 0;
  private lastPitch?: number;

  get waveform(): string {
    const value = getRuntimeParameterEffectiveValue(this.parameters, 'waveform');

    return typeof value === 'string' ? value : 'sine';
  }

  get volume(): number {
    const value = getRuntimeParameterEffectiveValue(this.parameters, 'volume');

    return typeof value === 'number' ? value : 0.25;
  }

  processEvents(events: readonly TEvent[]): void {
    this.pendingVoiceActions = [];

    for (const event of events) {
      if (isNoteOnEvent(event)) {
        const glide = this.getGlide(event.destination?.trackId, event.pitch);
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
          amplitude: this.voiceAmplitude(result.voice.velocity),
          timeMs: event.timeMs,
          envelope: this.getEnvelope(),
          glide
        });
        this.lastPitch = result.voice.pitch;

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
    this.advanceLfo(deltaMs);
  }

  getDiagnostics(): { voices: ReturnType<VoiceManager['stats']> } {
    return {
      voices: this.voices.stats()
    };
  }

  panic(): void {
    this.pendingVoiceActions = [];
    this.voices.clear();
    this.lastPitch = undefined;
  }

  private getEnvelope(): AdsrEnvelope {
    return {
      attack: numberParameter(this.parameters, 'attack', 0.01),
      decay: numberParameter(this.parameters, 'decay', 0.15),
      sustain: numberParameter(this.parameters, 'sustain', 0.7),
      release: numberParameter(this.parameters, 'release', 0.2)
    };
  }

  private getGlide(
    trackId: string | undefined,
    targetPitch: number
  ): Glide | undefined {
    const time = Math.max(0, numberParameter(this.parameters, 'glideTime', 0));

    if (time <= 0) return undefined;

    const mode = getRuntimeParameterEffectiveValue(this.parameters, 'glideMode');

    if (mode === 'off') return undefined;

    const previousPitch = mode === 'always'
      ? this.lastPitch
      : latestActivePitch(this.voices.activeVoices(), trackId);

    if (
      previousPitch === undefined ||
      previousPitch === targetPitch ||
      !Number.isFinite(previousPitch)
    ) {
      return undefined;
    }

    return {
      startPitch: previousPitch,
      time
    };
  }

  private advanceLfo(deltaMs: number): void {
    const cutoff = getRuntimeParameter(this.parameters, 'cutoff');

    if (!cutoff) return;

    const target = getRuntimeParameterEffectiveValue(this.parameters, 'lfoTarget');

    if (target !== 'cutoff') {
      setRuntimeParameterModulation(cutoff, 0);
      return;
    }

    const rate = Math.max(0, numberParameter(this.parameters, 'lfoRate', 0));
    const depth = numberParameter(this.parameters, 'lfoDepth', 0);

    this.lfoPhase += (deltaMs / 1000) * rate * Math.PI * 2;
    this.lfoPhase %= Math.PI * 2;

    setRuntimeParameterModulation(cutoff, Math.sin(this.lfoPhase) * depth);
  }

  private voiceAmplitude(velocity: number): number {
    const velocityToAmp = clampUnit(
      numberParameter(this.parameters, 'velocityToAmp', 1)
    );
    const normalizedVelocity = clampUnit(velocity);

    return 1 + (normalizedVelocity - 1) * velocityToAmp;
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
  const value = getRuntimeParameterEffectiveValue(parameters, key);
  const numberValue = Number(value ?? fallback);

  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;

  return Math.min(1, Math.max(0, value));
}

function latestActivePitch(
  voices: ReturnType<VoiceManager['activeVoices']>,
  trackId: string | undefined
): number | undefined {
  const candidates = trackId
    ? voices.filter((voice) => voice.trackId === trackId)
    : voices;
  const latest = [...candidates].sort(
    (left, right) => right.startedAtMs - left.startedAtMs
  )[0];

  return latest?.pitch;
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
