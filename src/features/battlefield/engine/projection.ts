import type { BattlefieldBounds } from "@/lib/battle/types";

export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * Local flat projection centered on the battlefield. World units are meters:
 * +x east, +y south (screen-friendly).
 */
export interface Projection {
  centerLat: number;
  centerLng: number;
  widthM: number;
  heightM: number;
  toWorld(lat: number, lng: number): WorldPoint;
  toLatLng(point: WorldPoint): { lat: number; lng: number };
}

const METERS_PER_DEG_LAT = 110_540;

export function metersPerDegLng(latDeg: number): number {
  return 111_320 * Math.cos((latDeg * Math.PI) / 180);
}

export function createProjection(bounds: BattlefieldBounds): Projection {
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  const mPerDegLng = metersPerDegLng(centerLat);

  return {
    centerLat,
    centerLng,
    widthM: (bounds.east - bounds.west) * mPerDegLng,
    heightM: (bounds.north - bounds.south) * METERS_PER_DEG_LAT,
    toWorld(lat: number, lng: number): WorldPoint {
      return {
        x: (lng - centerLng) * mPerDegLng,
        y: (centerLat - lat) * METERS_PER_DEG_LAT,
      };
    },
    toLatLng(point: WorldPoint): { lat: number; lng: number } {
      return {
        lat: centerLat - point.y / METERS_PER_DEG_LAT,
        lng: centerLng + point.x / mPerDegLng,
      };
    },
  };
}

/**
 * Convert a Mapbox-style zoom level to canvas scale (CSS px per meter) at the
 * given latitude, so existing chapter camera data keeps meaning what it meant.
 */
export function zoomToPixelsPerMeter(zoom: number, latDeg: number): number {
  const metersPerPixel = (78_271.517 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** zoom;
  return 1 / metersPerPixel;
}
