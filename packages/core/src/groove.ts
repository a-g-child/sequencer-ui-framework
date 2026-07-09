import type { BeatTime } from "./events.ts";

export type GrooveDivision = 0.25 | 0.5;

export interface GrooveSettings {
  enabled: boolean;
  amount: number;
  division: GrooveDivision;
}

export function createDefaultGrooveSettings(): GrooveSettings {
  return {
    enabled: false,
    amount: 0,
    division: 0.25
  };
}

export function normalizeGrooveSettings(
  groove: Partial<GrooveSettings> | undefined
): GrooveSettings {
  const defaults = createDefaultGrooveSettings();
  const amount = clampUnit(Number(groove?.amount ?? defaults.amount));
  const division = groove?.division === 0.5 ? 0.5 : 0.25;

  return {
    enabled: Boolean(groove?.enabled) && amount > 0,
    amount,
    division
  };
}

export function grooveBeat(
  beat: BeatTime,
  groove: GrooveSettings | undefined
): BeatTime {
  const settings = normalizeGrooveSettings(groove);

  if (!settings.enabled) return beat;

  const division = settings.division;
  const pairLength = division * 2;
  const delay = division * 0.5 * settings.amount;

  if (delay <= 0 || !Number.isFinite(beat)) return beat;

  const pairStart = Math.floor(beat / pairLength) * pairLength;
  const local = beat - pairStart;

  if (local <= division) {
    return pairStart + scaleRange(local, 0, division, 0, division + delay);
  }

  return pairStart + scaleRange(local, division, pairLength, division + delay, pairLength);
}

export function ungrooveBeat(
  beat: BeatTime,
  groove: GrooveSettings | undefined
): BeatTime {
  const settings = normalizeGrooveSettings(groove);

  if (!settings.enabled) return beat;

  const division = settings.division;
  const pairLength = division * 2;
  const delay = division * 0.5 * settings.amount;
  const swungDivision = division + delay;

  if (delay <= 0 || !Number.isFinite(beat)) return beat;

  const pairStart = Math.floor(beat / pairLength) * pairLength;
  const local = beat - pairStart;

  if (local <= swungDivision) {
    return pairStart + scaleRange(local, 0, swungDivision, 0, division);
  }

  return pairStart + scaleRange(local, swungDivision, pairLength, division, pairLength);
}

function scaleRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  if (inMax <= inMin) return outMin;

  const normalized = (value - inMin) / (inMax - inMin);

  return outMin + normalized * (outMax - outMin);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;

  return Math.min(1, Math.max(0, value));
}
