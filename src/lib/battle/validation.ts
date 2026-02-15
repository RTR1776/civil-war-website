import type { BattleDataBundle } from "@/lib/battle/types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBattleData(bundle: BattleDataBundle): ValidationResult {
  const errors: string[] = [];
  const unitIds = new Set(bundle.units.map((unit) => unit.id));

  const start = Date.parse(bundle.manifest.timeStart);
  const end = Date.parse(bundle.manifest.timeEnd);

  for (const timeSlice of bundle.timeSlices) {
    const current = Date.parse(timeSlice.timestamp);

    if (Number.isNaN(current)) {
      errors.push(`Invalid timestamp format: ${timeSlice.timestamp}`);
      continue;
    }

    if (current < start || current > end) {
      errors.push(`Timestamp outside battle window: ${timeSlice.timestamp}`);
    }

    for (const position of timeSlice.unitPositions) {
      if (!unitIds.has(position.unitId)) {
        errors.push(
          `Unit position references unknown unit id: ${position.unitId} (${timeSlice.timestamp})`,
        );
      }
    }
  }

  for (const casualtyTick of bundle.casualtyTimeline) {
    const current = Date.parse(casualtyTick.time);

    if (Number.isNaN(current)) {
      errors.push(`Invalid casualty timestamp format: ${casualtyTick.time}`);
      continue;
    }

    if (current < start || current > end) {
      errors.push(`Casualty timestamp outside battle window: ${casualtyTick.time}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
