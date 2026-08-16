import type { WorldPoint } from "@/features/battlefield/engine/projection";
import { createProjection, type Projection } from "@/features/battlefield/engine/projection";
import type { ScenarioDataBundle } from "@/lib/battle/types";

interface HillDef {
  x: number;
  y: number;
  radiusM: number;
  heightM: number;
}

/**
 * Procedural battlefield elevation model derived from the scenario's map
 * layers (hills, the Harpeth channel, Figuers Bluff under Fort Granger).
 * World coordinates are the same meters-based frame as the 2D map: +x east,
 * +y south. Elevation is meters above the Franklin plain.
 */
export class TerrainModel {
  readonly projection: Projection;
  private hills: HillDef[] = [];
  private riverPoints: WorldPoint[] = [];

  constructor(bundle: ScenarioDataBundle) {
    this.projection = createProjection(bundle.manifest.bounds);

    for (const feature of bundle.mapLayerPack.features) {
      const props = feature.properties;

      if (feature.geometry.type === "Point") {
        const [lng, lat] = feature.geometry.coordinates;
        const world = this.projection.toWorld(lat, lng);
        const radiusM = typeof (props as unknown as { radiusM?: unknown }).radiusM === "number"
          ? (props as unknown as { radiusM: number }).radiusM
          : 120;

        if (props.styleKey === "hill") {
          // Winstead & Breezy rise ~30 m over the plain; smaller knobs less.
          this.hills.push({
            x: world.x,
            y: world.y,
            radiusM,
            heightM: Math.min(34, 8 + radiusM * 0.062),
          });
        } else if (props.styleKey === "fort") {
          // Figuers Bluff: the height Fort Granger's guns fired from.
          this.hills.push({ x: world.x, y: world.y, radiusM: 300, heightM: 14 });
        }
      }

      if (feature.geometry.type === "LineString" && props.category === "river") {
        for (const [lng, lat] of feature.geometry.coordinates) {
          this.riverPoints.push(this.projection.toWorld(lat, lng));
        }
      }
    }
  }

  /** Distance in meters from the river centerline (Infinity when no river). */
  riverDistance(x: number, y: number): number {
    let best = Infinity;

    for (let index = 0; index < this.riverPoints.length - 1; index += 1) {
      const a = this.riverPoints[index];
      const b = this.riverPoints[index + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const lengthSq = abx * abx + aby * aby;
      const t = lengthSq === 0
        ? 0
        : Math.min(1, Math.max(0, ((x - a.x) * abx + (y - a.y) * aby) / lengthSq));
      const px = a.x + abx * t;
      const py = a.y + aby * t;
      best = Math.min(best, Math.hypot(x - px, y - py));
    }

    return best;
  }

  /** Elevation in meters at a world position. */
  elevation(x: number, y: number): number {
    let height = 0;

    // Hills: smooth gaussian rises.
    for (const hill of this.hills) {
      const distance = Math.hypot(x - hill.x, y - hill.y);
      const sigma = hill.radiusM * 0.62;
      height += hill.heightM * Math.exp(-(distance * distance) / (2 * sigma * sigma));
    }

    // Gentle rolling fields (deterministic, no RNG needed).
    height += 1.1 * Math.sin(x / 310 + 1.7) * Math.sin(y / 270 + 0.6);
    height += 0.7 * Math.sin((x + y) / 190 + 3.1);

    // The plain eases down toward the river, then the channel cuts in.
    const riverDist = this.riverDistance(x, y);
    if (Number.isFinite(riverDist)) {
      const valley = Math.max(0, 1 - riverDist / 600);
      height -= 3.2 * valley * valley;

      if (riverDist < 90) {
        const bank = 1 - riverDist / 90;
        const eased = bank * bank * (3 - 2 * bank);
        height -= 7.5 * eased;
      }
    }

    return height;
  }

  /** Water surface height for the Harpeth. */
  static readonly WATER_LEVEL = -5.1;
}
