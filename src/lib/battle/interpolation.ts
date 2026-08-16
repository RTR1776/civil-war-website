import {
  type CasualtyTick,
  type ConfidenceLevel,
  type InterpolatedFormationPosition,
  type MovementKeyframe,
  type MovementPosition,
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

function normalizeLegacyTimeSlices(timeSlices: TimeSlice[]): MovementKeyframe[] {
  return timeSlices.map((timeSlice) => ({
    timestamp: timeSlice.timestamp,
    confidence: timeSlice.confidence,
    interpolationHint: "linear",
    positions: timeSlice.unitPositions.map((position) => ({
      formationId: position.unitId,
      lat: position.lat,
      lng: position.lng,
      elevation: position.elevation,
      formation: position.formation,
      engaged: position.engaged,
    })),
  }));
}

function resolveBlend(interpolationHint: MovementKeyframe["interpolationHint"], amount: number): number {
  if (interpolationHint === "hold") {
    return 0;
  }

  if (interpolationHint === "step-forward") {
    return amount >= 1 ? 1 : 0;
  }

  return amount;
}

function resolveBetween(
  first: MovementPosition | undefined,
  second: MovementPosition | undefined,
  amount: number,
  confidence: ConfidenceLevel,
  interpolationHint: MovementKeyframe["interpolationHint"],
): InterpolatedFormationPosition | null {
  if (!first && !second) {
    return null;
  }

  if (!first && second) {
    return {
      formationId: second.formationId,
      unitId: second.formationId,
      lat: second.lat,
      lng: second.lng,
      engaged: Boolean(second.engaged),
      formation: second.formation,
      confidence,
      uncertaintyMeters: second.uncertaintyMeters,
    };
  }

  if (first && !second) {
    return {
      formationId: first.formationId,
      unitId: first.formationId,
      lat: first.lat,
      lng: first.lng,
      engaged: Boolean(first.engaged),
      formation: first.formation,
      confidence,
      uncertaintyMeters: first.uncertaintyMeters,
    };
  }

  if (!first || !second) {
    return null;
  }

  const blend = resolveBlend(interpolationHint, amount);
  const uncertainty = Math.max(first.uncertaintyMeters ?? 0, second.uncertaintyMeters ?? 0);

  return {
    formationId: first.formationId,
    unitId: first.formationId,
    lat: lerpNumber(first.lat, second.lat, blend),
    lng: lerpNumber(first.lng, second.lng, blend),
    engaged: Boolean(second.engaged ?? first.engaged),
    formation: second.formation ?? first.formation,
    confidence,
    uncertaintyMeters: uncertainty > 0 ? uncertainty : undefined,
  };
}

function sortKeyframes(keyframes: MovementKeyframe[]): MovementKeyframe[] {
  return [...keyframes].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function interpolateFormationPositions(
  targetTime: number,
  movementKeyframes: MovementKeyframe[],
): InterpolatedFormationPosition[] {
  if (movementKeyframes.length === 0) {
    return [];
  }

  const orderedKeyframes = sortKeyframes(movementKeyframes);

  const start = Date.parse(orderedKeyframes[0].timestamp);
  const end = Date.parse(orderedKeyframes[orderedKeyframes.length - 1].timestamp);
  const safeTime = clampTime(targetTime, start, end);

  let leftKeyframe = orderedKeyframes[0];
  let rightKeyframe = orderedKeyframes[orderedKeyframes.length - 1];

  for (let index = 0; index < orderedKeyframes.length - 1; index += 1) {
    const current = orderedKeyframes[index];
    const next = orderedKeyframes[index + 1];
    const currentTime = Date.parse(current.timestamp);
    const nextTime = Date.parse(next.timestamp);

    if (safeTime >= currentTime && safeTime <= nextTime) {
      leftKeyframe = current;
      rightKeyframe = next;
      break;
    }
  }

  const leftTime = Date.parse(leftKeyframe.timestamp);
  const rightTime = Date.parse(rightKeyframe.timestamp);
  const timeWindow = Math.max(1, rightTime - leftTime);
  const blend = clampTime((safeTime - leftTime) / timeWindow, 0, 1);

  const byFormation = new Map<string, { left?: MovementPosition; right?: MovementPosition }>();

  for (const position of leftKeyframe.positions) {
    byFormation.set(position.formationId, { left: position });
  }

  for (const position of rightKeyframe.positions) {
    const existing = byFormation.get(position.formationId);
    byFormation.set(position.formationId, {
      left: existing?.left,
      right: position,
    });
  }

  const confidence: ConfidenceLevel =
    leftKeyframe.confidence === "documented" && rightKeyframe.confidence === "documented"
      ? "documented"
      : "inferred";

  return [...byFormation.values()]
    .map((pair) =>
      resolveBetween(pair.left, pair.right, blend, confidence, rightKeyframe.interpolationHint),
    )
    .filter((value): value is InterpolatedFormationPosition => value !== null);
}

export function interpolateUnitPositions(
  targetTime: number,
  timeSlices: TimeSlice[] | MovementKeyframe[],
): InterpolatedFormationPosition[] {
  if (timeSlices.length === 0) {
    return [];
  }

  const first = timeSlices[0] as TimeSlice | MovementKeyframe;

  if ("unitPositions" in first) {
    return interpolateFormationPositions(targetTime, normalizeLegacyTimeSlices(timeSlices as TimeSlice[]));
  }

  return interpolateFormationPositions(targetTime, timeSlices as MovementKeyframe[]);
}

export interface CasualtyStateAt {
  value: number;
  confidence: ConfidenceLevel;
  note?: string;
}

export function casualtiesAtTime(timeline: CasualtyTick[], targetTime: number): CasualtyStateAt {
  if (timeline.length === 0) {
    return { value: 0, confidence: "inferred" };
  }

  const ordered = [...timeline].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const clamped = clampTime(targetTime, Date.parse(first.time), Date.parse(last.time));

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const left = ordered[index];
    const right = ordered[index + 1];
    const leftTime = Date.parse(left.time);
    const rightTime = Date.parse(right.time);

    if (clamped >= leftTime && clamped <= rightTime) {
      const ratio = (clamped - leftTime) / Math.max(1, rightTime - leftTime);
      return {
        value: Math.round(
          left.cumulativeCasualties + (right.cumulativeCasualties - left.cumulativeCasualties) * ratio,
        ),
        confidence:
          left.confidence === "documented" && right.confidence === "documented"
            ? "documented"
            : "inferred",
        note: right.note ?? left.note,
      };
    }
  }

  return { value: last.cumulativeCasualties, confidence: last.confidence, note: last.note };
}

export function toLegacyUnitPosition(position: MovementPosition): UnitPosition {
  return {
    unitId: position.formationId,
    lat: position.lat,
    lng: position.lng,
    elevation: position.elevation,
    formation: position.formation,
    engaged: position.engaged,
  };
}
