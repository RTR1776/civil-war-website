import type { Projection } from "@/features/battlefield/engine/projection";

export interface Vantage {
  id: string;
  label: string;
  /** Camera position in world meters (x east, y up, z south). */
  position: { x: number; y: number; z: number };
  /** Orbit target. */
  target: { x: number; y: number; z: number };
  /** Formation id to track instead of a fixed target. */
  followFormationId?: string;
}

/**
 * Cinematic vantage points around the field. Elevations are offsets above the
 * terrain; the host adds ground height when applying them.
 */
export function vantagePoints(projection: Projection): Vantage[] {
  const carter = projection.toWorld(35.9224, -86.8597);
  const winstead = projection.toWorld(35.9096, -86.862);
  const granger = projection.toWorld(35.9297, -86.856);
  const flank = projection.toWorld(35.9235, -86.8262);
  const assaultPlain = projection.toWorld(35.917, -86.8595);

  return [
    {
      id: "salient",
      label: "The Carter Salient",
      position: { x: carter.x + 90, y: 64, z: carter.y + 560 },
      target: { x: carter.x, y: 8, z: carter.y - 40 },
    },
    {
      id: "winstead",
      label: "Winstead Hill Overlook",
      position: { x: winstead.x - 40, y: 84, z: winstead.y + 60 },
      target: { x: assaultPlain.x, y: 0, z: assaultPlain.y - 520 },
    },
    {
      id: "granger",
      label: "Fort Granger Guns",
      position: { x: granger.x + 60, y: 46, z: granger.y - 220 },
      target: { x: carter.x + 60, y: 6, z: carter.y },
    },
    {
      id: "flank",
      label: "Cavalry Flank",
      position: { x: flank.x + 120, y: 110, z: flank.y + 620 },
      target: { x: flank.x, y: 4, z: flank.y - 260 },
    },
    {
      id: "charge",
      label: "Ride with Cleburne",
      position: { x: assaultPlain.x + 40, y: 46, z: assaultPlain.y + 300 },
      target: { x: assaultPlain.x, y: 6, z: assaultPlain.y },
      followFormationId: "conf-cleburne-division",
    },
  ];
}
