import type { BattlefieldBounds, TerrainConfig, TerrainDem } from "@/lib/battle/types";

export interface BattlefieldPoint {
  x: number;
  z: number;
}

export const BATTLEFIELD_WIDTH = 220;
export const BATTLEFIELD_DEPTH = 220;

export function latLngToBattlefield(
  lat: number,
  lng: number,
  bounds: BattlefieldBounds,
): BattlefieldPoint {
  const xRatio = (lng - bounds.west) / (bounds.east - bounds.west);
  const zRatio = (lat - bounds.south) / (bounds.north - bounds.south);

  return {
    x: (xRatio - 0.5) * BATTLEFIELD_WIDTH,
    z: (zRatio - 0.5) * BATTLEFIELD_DEPTH,
  };
}

export function battlefieldToLatLng(
  x: number,
  z: number,
  bounds: BattlefieldBounds,
): { lat: number; lng: number } {
  return {
    lng: bounds.west + ((x / BATTLEFIELD_WIDTH + 0.5) * (bounds.east - bounds.west)),
    lat: bounds.south + ((z / BATTLEFIELD_DEPTH + 0.5) * (bounds.north - bounds.south)),
  };
}

function sampleDemHeight(x: number, z: number, dem: TerrainDem): number | null {
  if (dem.heights.length === 0 || dem.width < 2 || dem.height < 2) {
    return null;
  }

  const xRatio = x / BATTLEFIELD_WIDTH + 0.5;
  const zRatio = z / BATTLEFIELD_DEPTH + 0.5;

  const sampleX = Math.min(dem.width - 1, Math.max(0, xRatio * (dem.width - 1)));
  const sampleZ = Math.min(dem.height - 1, Math.max(0, zRatio * (dem.height - 1)));

  const x0 = Math.floor(sampleX);
  const x1 = Math.min(dem.width - 1, x0 + 1);
  const z0 = Math.floor(sampleZ);
  const z1 = Math.min(dem.height - 1, z0 + 1);

  const tx = sampleX - x0;
  const tz = sampleZ - z0;

  const index = (row: number, column: number) => row * dem.width + column;
  const h00 = dem.heights[index(z0, x0)] ?? dem.minElevation;
  const h10 = dem.heights[index(z0, x1)] ?? dem.minElevation;
  const h01 = dem.heights[index(z1, x0)] ?? dem.minElevation;
  const h11 = dem.heights[index(z1, x1)] ?? dem.minElevation;

  const top = h00 + (h10 - h00) * tx;
  const bottom = h01 + (h11 - h01) * tx;
  return top + (bottom - top) * tz;
}

function proceduralMicroRelief(x: number, z: number, terrain: TerrainConfig): number {
  const folded = Math.sin((x + z) * 0.03) * 0.7;
  const rough = Math.sin(x * 0.11) * Math.cos(z * 0.09) * terrain.roughness;
  return (folded + rough) * 0.7;
}

export function terrainHeight(
  x: number,
  z: number,
  terrain: TerrainConfig,
  dem?: TerrainDem | null,
): number {
  if (dem) {
    const sampled = sampleDemHeight(x, z, dem);
    if (sampled !== null) {
      const normalized =
        (sampled - dem.minElevation) / Math.max(0.001, dem.maxElevation - dem.minElevation);
      const centered = (normalized - 0.5) * terrain.verticalScale;
      const exaggeration = terrain.demVerticalExaggeration ?? 1;
      return centered * exaggeration + proceduralMicroRelief(x, z, terrain);
    }
  }

  const ridges = Math.sin(x * 0.05) * 2.8 + Math.cos(z * 0.04) * 2.2;
  const folded = Math.sin((x + z) * 0.03) * 1.8;
  const rough = Math.sin(x * 0.11) * Math.cos(z * 0.09) * terrain.roughness * 4;
  return (ridges + folded + rough) * (terrain.verticalScale / 24);
}
