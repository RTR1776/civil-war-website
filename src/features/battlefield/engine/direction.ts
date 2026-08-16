import type { CameraPose } from "@/features/battlefield/engine/camera";
import { type Projection, zoomToPixelsPerMeter } from "@/features/battlefield/engine/projection";
import type { ChapterScene, NarrativeBeat } from "@/lib/battle/types";

const DEG_TO_RAD = Math.PI / 180;

/**
 * Resolve the cinematic camera pose for a chapter at a given simulation time
 * by interpolating along its camera rail (offsets are sim-time ms from the
 * chapter start).
 */
export function chapterPoseAt(
  chapter: ChapterScene,
  simTimeMs: number,
  projection: Projection,
): CameraPose | null {
  const rail = chapter.cameraRail;
  if (rail.length === 0) {
    return null;
  }

  const offset = Math.max(0, simTimeMs - Date.parse(chapter.startTime));

  let left = rail[0];
  let right = rail[rail.length - 1];

  for (let index = 0; index < rail.length - 1; index += 1) {
    if (offset >= rail[index].timeOffsetMs && offset <= rail[index + 1].timeOffsetMs) {
      left = rail[index];
      right = rail[index + 1];
      break;
    }
  }

  if (offset < rail[0].timeOffsetMs) {
    right = left;
  }

  const span = Math.max(1, right.timeOffsetMs - left.timeOffsetMs);
  const blend = Math.min(1, Math.max(0, (offset - left.timeOffsetMs) / span));

  const lat = left.lat + (right.lat - left.lat) * blend;
  const lng = left.lng + (right.lng - left.lng) * blend;
  const zoom = left.zoom + (right.zoom - left.zoom) * blend;
  const bearing = left.bearing + (right.bearing - left.bearing) * blend;
  const world = projection.toWorld(lat, lng);

  return {
    x: world.x,
    y: world.y,
    scale: zoomToPixelsPerMeter(zoom, lat),
    bearing: bearing * DEG_TO_RAD,
  };
}

export function beatPose(beat: NarrativeBeat, projection: Projection): CameraPose {
  const world = projection.toWorld(beat.cameraPose.lat, beat.cameraPose.lng);
  // Legacy beat poses carry a "distance" in arbitrary units (~40-80); map it
  // onto a satisfying zoom band (closer beats zoom in harder).
  const zoom = 15.4 - Math.min(1.6, Math.max(0, (beat.cameraPose.distance - 40) / 40) * 1.6);

  return {
    x: world.x,
    y: world.y,
    scale: zoomToPixelsPerMeter(zoom, beat.cameraPose.lat),
    bearing: beat.cameraPose.yaw * DEG_TO_RAD * 0.35,
  };
}

/**
 * Overview pose framing the whole battlefield inside the viewport.
 */
export function overviewPose(
  projection: Projection,
  viewportWidth: number,
  viewportHeight: number,
): CameraPose {
  const scale = Math.min(
    viewportWidth / (projection.widthM * 1.06),
    viewportHeight / (projection.heightM * 1.12),
  );

  return { x: 0, y: -projection.heightM * 0.06, scale, bearing: 0 };
}

export interface AttractShot {
  x: number;
  y: number;
  scale: number;
  bearing: number;
  holdMs: number;
}

/**
 * Slow drifting shots used behind the intro veil before the user starts.
 */
export function attractShots(projection: Projection): AttractShot[] {
  const carter = projection.toWorld(35.9224, -86.8597);
  const winstead = projection.toWorld(35.9105, -86.862);
  const river = projection.toWorld(35.9295, -86.8585);
  const works = projection.toWorld(35.9218, -86.868);

  return [
    { x: carter.x, y: carter.y, scale: zoomToPixelsPerMeter(14.35, 35.92), bearing: 0.12, holdMs: 9000 },
    { x: winstead.x, y: winstead.y, scale: zoomToPixelsPerMeter(14.05, 35.91), bearing: -0.1, holdMs: 9000 },
    { x: works.x, y: works.y, scale: zoomToPixelsPerMeter(14.5, 35.92), bearing: 0.2, holdMs: 9000 },
    { x: river.x, y: river.y, scale: zoomToPixelsPerMeter(14.2, 35.93), bearing: -0.16, holdMs: 9000 },
  ];
}
