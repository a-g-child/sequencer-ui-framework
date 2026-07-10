import { LFO_DESCRIPTOR } from '../descriptors/lfo.ts';
import type { DeviceFactory } from '../factory.ts';
import type { DeviceInstance } from '../instance.ts';
import {
  advanceRuntimeParameters,
  createRuntimeParameters,
  getRuntimeParameterEffectiveValue
} from '../parameter-runtime.ts';
import { BaseRuntimeDevice } from '../runtime.ts';

export type LfoWaveform =
  | 'sine'
  | 'triangle'
  | 'saw-up'
  | 'saw-down'
  | 'square'
  | 'sample-hold';

export interface LfoModulation {
  readonly deviceInstanceId: string;
  readonly parameterKey: string;
  readonly value: number;
}

export interface LfoDiagnostics {
  readonly phase: number;
  readonly phaseOffset: number;
  readonly rateHz: number;
  readonly value: number;
  readonly target?: {
    readonly deviceInstanceId: string;
    readonly parameterKey: string;
  };
}

export class LfoRuntimeDevice<
  TEvent = unknown
> extends BaseRuntimeDevice<TEvent> {
  private phase = 0;
  private cycle = 0;
  private heldSampleValue = 0;
  private rateHz = 0;
  private value = 0;
  private pendingEvents: TEvent[] = [];

  processEvents(events: readonly TEvent[]): void {
    this.pendingEvents = [...events];
  }

  consumePlaybackEvents(): TEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  advance(deltaMs: number, context: { readonly bpm?: number } = {}): void {
    advanceRuntimeParameters(this.parameters, deltaMs);

    const rate = lfoRateHz(this.parameters, context.bpm);
    const depth = Math.max(0, numberParameter(this.parameters, 'depth', 0.25));
    const phaseOffset = wrapPhase(
      numberParameter(this.parameters, 'phase', 0) / 360
    );
    const waveform = waveformParameter(this.parameters, 'waveform', 'sine');
    const nextPhase = this.phase + (deltaMs / 1000) * rate;
    const elapsedCycles = Math.floor(nextPhase);

    this.rateHz = rate;
    this.phase = wrapPhase(nextPhase);

    if (elapsedCycles > 0) {
      this.cycle += elapsedCycles;
      this.heldSampleValue = randomBipolarValue(this.cycle);
    }

    this.value =
      renderWaveform(waveform, wrapPhase(this.phase + phaseOffset), {
        heldSampleValue: this.heldSampleValue
      }) * depth;
  }

  consumeModulation(): LfoModulation | undefined {
    const deviceInstanceId = stringParameter(
      this.parameters,
      'targetDeviceId',
      ''
    );
    const parameterKey = stringParameter(
      this.parameters,
      'targetParameterKey',
      ''
    );

    if (!deviceInstanceId || !parameterKey) return undefined;

    return {
      deviceInstanceId,
      parameterKey,
      value: this.value
    };
  }

  getDiagnostics(): LfoDiagnostics {
    const modulation = this.consumeModulation();

    return {
      phase: this.phase,
      phaseOffset: numberParameter(this.parameters, 'phase', 0),
      rateHz: this.rateHz,
      value: this.value,
      target: modulation
        ? {
            deviceInstanceId: modulation.deviceInstanceId,
            parameterKey: modulation.parameterKey
          }
        : undefined
    };
  }

  panic(): void {
    this.pendingEvents = [];
    this.value = 0;
    this.heldSampleValue = 0;
    this.rateHz = 0;
  }
}

export class LfoFactory<TEvent = unknown> implements DeviceFactory<TEvent> {
  readonly descriptor = LFO_DESCRIPTOR;

  create(instance: DeviceInstance): LfoRuntimeDevice<TEvent> {
    return new LfoRuntimeDevice(
      instance,
      createRuntimeParameters(this.descriptor, instance)
    );
  }
}

function numberParameter(
  parameters: LfoRuntimeDevice['parameters'],
  key: string,
  fallback: number
): number {
  const value = getRuntimeParameterEffectiveValue(parameters, key);
  const numberValue = Number(value ?? fallback);

  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function stringParameter(
  parameters: LfoRuntimeDevice['parameters'],
  key: string,
  fallback: string
): string {
  const value = getRuntimeParameterEffectiveValue(parameters, key);

  return typeof value === 'string' ? value : fallback;
}

function waveformParameter(
  parameters: LfoRuntimeDevice['parameters'],
  key: string,
  fallback: LfoWaveform
): LfoWaveform {
  const value = stringParameter(parameters, key, fallback);

  if (value === 'saw') return 'saw-up';

  return isLfoWaveform(value) ? value : fallback;
}

function lfoRateHz(
  parameters: LfoRuntimeDevice['parameters'],
  bpm: number | undefined
): number {
  const mode = stringParameter(parameters, 'rateMode', 'free');

  if (mode === 'sync') {
    return syncDivisionHz(
      stringParameter(parameters, 'syncDivision', '1/4'),
      bpm
    );
  }

  return Math.max(0, numberParameter(parameters, 'rate', 0.5));
}

function isLfoWaveform(value: string): value is LfoWaveform {
  return (
    value === 'sine' ||
    value === 'triangle' ||
    value === 'saw-up' ||
    value === 'saw-down' ||
    value === 'square' ||
    value === 'sample-hold'
  );
}

function renderWaveform(
  waveform: LfoWaveform,
  phase: number,
  state: { readonly heldSampleValue: number }
): number {
  switch (waveform) {
    case 'triangle':
      return 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));
    case 'saw-up':
      return phase * 2 - 1;
    case 'saw-down':
      return 1 - phase * 2;
    case 'square':
      return phase < 0.5 ? 1 : -1;
    case 'sample-hold':
      return state.heldSampleValue;
    case 'sine':
    default:
      return Math.sin(phase * Math.PI * 2);
  }
}

function wrapPhase(phase: number): number {
  return ((phase % 1) + 1) % 1;
}

function randomBipolarValue(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;

  return (value - Math.floor(value)) * 2 - 1;
}

function syncDivisionHz(division: string, bpm: number | undefined): number {
  const safeBpm = Math.max(1, Number.isFinite(bpm) ? Number(bpm) : 120);
  const cycleBeats = lfoDivisionBeats(division);

  return safeBpm / 60 / cycleBeats;
}

function lfoDivisionBeats(division: string): number {
  switch (division) {
    case '4/1':
      return 16;
    case '2/1':
      return 8;
    case '1/1':
      return 4;
    case '1/2':
      return 2;
    case '1/2.':
      return 3;
    case '1/2T':
      return 4 / 3;
    case '1/4.':
      return 1.5;
    case '1/4T':
      return 2 / 3;
    case '1/8':
      return 0.5;
    case '1/8.':
      return 0.75;
    case '1/8T':
      return 1 / 3;
    case '1/16':
      return 0.25;
    case '1/16.':
      return 0.375;
    case '1/16T':
      return 1 / 6;
    case '1/32':
      return 0.125;
    case '1/4':
    default:
      return 1;
  }
}
