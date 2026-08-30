import type { CasualtyTick } from "@/lib/battle/types";

export interface IntensityCurve {
  segments: Array<{ t0: number; t1: number; rate: number }>;
  maxRate: number;
}

/**
 * How hard the field is burning at a given moment, on 0..1. Derived from the
 * slope of the documented casualty curve — the closest thing the record gives
 * to a measure of volume of fire.
 */
export function buildIntensityCurve(ticks: CasualtyTick[]): IntensityCurve {
  const segments: IntensityCurve["segments"] = [];
  let maxRate = 1e-9;

  for (let index = 0; index < ticks.length - 1; index += 1) {
    const t0 = Date.parse(ticks[index].time);
    const t1 = Date.parse(ticks[index + 1].time);
    const rate = (ticks[index + 1].cumulativeCasualties - ticks[index].cumulativeCasualties)
      / Math.max(1, t1 - t0);
    segments.push({ t0, t1, rate });
    maxRate = Math.max(maxRate, rate);
  }

  return { segments, maxRate };
}

export function intensityAt(curve: IntensityCurve, timeMs: number): number {
  for (const segment of curve.segments) {
    if (timeMs >= segment.t0 && timeMs <= segment.t1) {
      return Math.min(1, segment.rate / curve.maxRate);
    }
  }
  return 0;
}

/**
 * The same curve, smoothed across segment boundaries. The checkpoint totals
 * are hourly, so the raw curve steps; audio and other continuous consumers
 * want it to swell rather than jump.
 */
export function smoothIntensityAt(curve: IntensityCurve, timeMs: number, windowMs = 12 * 60_000): number {
  const samples = 5;
  let total = 0;

  for (let index = 0; index < samples; index += 1) {
    const offset = ((index / (samples - 1)) - 0.5) * 2 * windowMs;
    total += intensityAt(curve, timeMs + offset);
  }

  return total / samples;
}
