import {
  type ConfidenceLevel,
  type InterpolatedUnitPosition,
  type TimeSlice,
  type UnitPosition,
} from "@/lib/battle/types";

export interface ConfidenceStyle {
  opacity: number;
  dashed: boolean;
}

const MIN_OPACITY = 0.5;
const MAX_OPACITY = 1;

export function getConfidenceStyle(confidence: ConfidenceLevel): ConfidenceStyle {
  if (confidence === "documented") {
    return {
      opacity: MAX_OPACITY,
      dashed: false,
    };
  }

  return {
    opacity: MIN_OPACITY,
    dashed: true,
  };
}

export function clampTime(time: number, start: number, end: number): number {
  return Math.min(end, Math.max(start, time));
}

function lerpNumber(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function resolveBetween(
  first: UnitPosition | undefined,
  second: UnitPosition | undefined,
  amount: number,
  confidence: ConfidenceLevel,
): InterpolatedUnitPosition | null {
  if (!first && !second) {
    return null;
  }

  if (!first && second) {
    return {
      unitId: second.unitId,
      lat: second.lat,
      lng: second.lng,
      engaged: Boolean(second.engaged),
      formation: second.formation,
      confidence,
    };
  }

  if (first && !second) {
    return {
      unitId: first.unitId,
      lat: first.lat,
      lng: first.lng,
      engaged: Boolean(first.engaged),
      formation: first.formation,
      confidence,
    };
  }

  if (!first || !second) {
    return null;
  }

  const from = first;
  const to = second;

  return {
    unitId: from.unitId,
    lat: lerpNumber(from.lat, to.lat, amount),
    lng: lerpNumber(from.lng, to.lng, amount),
    engaged: Boolean(to.engaged ?? from.engaged),
    formation: to.formation ?? from.formation,
    confidence,
  };
}

export function interpolateUnitPositions(
  targetTime: number,
  timeSlices: TimeSlice[],
): InterpolatedUnitPosition[] {
  if (timeSlices.length === 0) {
    return [];
  }

  const orderedSlices = [...timeSlices].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  const start = Date.parse(orderedSlices[0].timestamp);
  const end = Date.parse(orderedSlices[orderedSlices.length - 1].timestamp);
  const safeTime = clampTime(targetTime, start, end);

  let leftSlice = orderedSlices[0];
  let rightSlice = orderedSlices[orderedSlices.length - 1];

  for (let index = 0; index < orderedSlices.length - 1; index += 1) {
    const current = orderedSlices[index];
    const next = orderedSlices[index + 1];
    const currentTime = Date.parse(current.timestamp);
    const nextTime = Date.parse(next.timestamp);

    if (safeTime >= currentTime && safeTime <= nextTime) {
      leftSlice = current;
      rightSlice = next;
      break;
    }
  }

  const leftTime = Date.parse(leftSlice.timestamp);
  const rightTime = Date.parse(rightSlice.timestamp);
  const timeWindow = Math.max(1, rightTime - leftTime);
  const blend = clampTime((safeTime - leftTime) / timeWindow, 0, 1);

  const byUnit = new Map<string, { left?: UnitPosition; right?: UnitPosition }>();

  for (const unitPosition of leftSlice.unitPositions) {
    byUnit.set(unitPosition.unitId, { left: unitPosition });
  }

  for (const unitPosition of rightSlice.unitPositions) {
    const existing = byUnit.get(unitPosition.unitId);
    byUnit.set(unitPosition.unitId, {
      left: existing?.left,
      right: unitPosition,
    });
  }

  const confidence: ConfidenceLevel =
    leftSlice.confidence === "documented" && rightSlice.confidence === "documented"
      ? "documented"
      : "inferred";

  return [...byUnit.values()]
    .map((pair) => resolveBetween(pair.left, pair.right, blend, confidence))
    .filter((value): value is InterpolatedUnitPosition => value !== null);
}
