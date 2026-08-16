const BATTLE_UTC_OFFSET_HOURS = -6;

const clockFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  // Fixed UTC-6 zone ("Etc/GMT+6" is UTC-6). The scenario data carries explicit
  // -06:00 offsets; formatting in the viewer's zone would shift every historical
  // clock reading, and "America/Chicago" resolves to LMT (-5:50:36) for 1864.
  timeZone: "Etc/GMT+6",
});

export function formatBattleClock(timestampMs: number): string {
  return clockFormatter.format(new Date(timestampMs));
}

export function battleHourOfDay(timestampMs: number): number {
  // 1864 timestamps are negative (pre-epoch), so normalize the modulo after
  // applying the offset.
  const hoursLocal = timestampMs / 3_600_000 + BATTLE_UTC_OFFSET_HOURS;
  return ((hoursLocal % 24) + 24) % 24;
}

export type DayPhase = "afternoon" | "golden" | "dusk" | "night";

// Franklin, TN on 1864-11-30: sunset ≈ 4:33 PM, civil twilight ends ≈ 5:02 PM.
// The moon was two days past new — the fighting famously continued into a
// nearly black night lit by muzzle flashes.
const SUNSET_HOUR = 16.55;
const GOLDEN_HOUR_START = 15.45;
const DUSK_END_HOUR = 17.4;

export function dayPhase(timestampMs: number): DayPhase {
  const hour = battleHourOfDay(timestampMs);

  if (hour < GOLDEN_HOUR_START) {
    return "afternoon";
  }

  if (hour < SUNSET_HOUR) {
    return "golden";
  }

  if (hour < DUSK_END_HOUR) {
    return "dusk";
  }

  return "night";
}

export const DAY_PHASE_LABEL: Record<DayPhase, string> = {
  afternoon: "Afternoon",
  golden: "Golden hour",
  dusk: "Dusk",
  night: "Night",
};

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 0 = full daylight, 1 = full night. Piecewise-smooth curve anchored on the
 * historical sunset/twilight times above.
 */
export function nightness(timestampMs: number): number {
  const hour = battleHourOfDay(timestampMs);

  return (
    0.16 * smoothstep(15.9, SUNSET_HOUR, hour)
    + 0.44 * smoothstep(SUNSET_HOUR, 17.1, hour)
    + 0.4 * smoothstep(17.1, 18.4, hour)
  );
}

/**
 * Strength of the warm sunset grade, peaking just before sunset and gone once
 * darkness takes over.
 */
export function goldenness(timestampMs: number): number {
  const hour = battleHourOfDay(timestampMs);
  const bell = Math.exp(-((hour - 16.15) ** 2) / (2 * 0.55 ** 2));
  return bell * (1 - smoothstep(16.9, 17.5, hour));
}
