"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  Point,
  Polygon,
} from "geojson";
import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";

import { interpolateFormationPositions } from "@/lib/battle/interpolation";
import type {
  ChapterScene,
  Formation,
  MapLabel,
  MapLayerFeature,
  MapLayerPack,
  MapMode,
  MovementKeyframe,
  NarrativeBeat,
  ScenarioManifest,
} from "@/lib/battle/types";

interface PresentDayMapboxProps {
  manifest: ScenarioManifest;
  formations: Formation[];
  movementKeyframes: MovementKeyframe[];
  mapLabels: MapLabel[];
  narrativeBeats: NarrativeBeat[];
  chapters?: ChapterScene[];
  mapLayerPack?: MapLayerPack;
  selectedTime: number;
  activeBeatId: string | null;
  activeChapterId?: string | null;
  guidedMode: boolean;
  selectedFormationId?: string | null;
  mapMode?: MapMode;
  lockedFormationId?: string | null;
  reducedMotion?: boolean;
  onSelectFormation?: (formationId: string | null) => void;
}

const STYLE_BY_MODE: Record<MapMode, string> = {
  reconstructed: "mapbox://styles/mapbox/navigation-day-v1",
  modern: "mapbox://styles/mapbox/standard-satellite",
};

const MAP_MODE_FOG: Record<MapMode, Record<string, number | string>> = {
  reconstructed: {
    color: "#c9b08f",
    "high-color": "#ead2ac",
    "horizon-blend": 0.34,
    "space-color": "#d7c3a3",
  },
  modern: {
    color: "#cad5df",
    "high-color": "#dde7ef",
    "horizon-blend": 0.2,
    "space-color": "#dfe8f0",
  },
};

interface TimedPoint {
  t: number;
  lat: number;
  lng: number;
  confidence: "documented" | "inferred";
  engaged: boolean;
}

interface Track {
  formationId: string;
  side: Formation["side"];
  points: TimedPoint[];
}

function getShortName(value: string): string {
  return value
    .replace("'s Division", "")
    .replace(" Division", "")
    .replace(" (XXIII Corps)", "")
    .replace(" (IV Corps)", "");
}

function troopDotCount(strength: number): number {
  return Math.max(12, Math.min(72, Math.round(strength / 120)));
}

function metersToLng(meters: number, lat: number): number {
  return meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

function metersToLat(meters: number): number {
  return meters / 110_540;
}

function buildFormationOffsets(count: number): Array<{ east: number; north: number }> {
  const offsets: Array<{ east: number; north: number }> = [];
  const spacing = 22;
  const width = Math.ceil(Math.sqrt(count));

  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / width);
    const col = index % width;
    const jitterA = ((index * 13) % 7) - 3;
    const jitterB = ((index * 17) % 11) - 5;

    offsets.push({
      east: (col - (width - 1) / 2) * spacing + jitterA * 1.9,
      north: (row - (Math.ceil(count / width) - 1) / 2) * spacing + jitterB * 1.6,
    });
  }

  return offsets;
}

function setSourceData<T extends Geometry>(
  map: MapboxMap,
  sourceId: string,
  data: FeatureCollection<T>,
) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
  }
}

function emptyPointCollection(): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function emptyLineCollection(): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function emptyPolygonCollection(): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function buildTracks(formations: Formation[], keyframes: MovementKeyframe[]): Track[] {
  const orderedKeyframes = [...keyframes].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const byFormation = new Map<string, TimedPoint[]>();

  for (const formation of formations) {
    byFormation.set(formation.id, []);
  }

  for (const keyframe of orderedKeyframes) {
    const t = Date.parse(keyframe.timestamp);
    for (const position of keyframe.positions) {
      const points = byFormation.get(position.formationId);
      if (!points) {
        continue;
      }

      points.push({
        t,
        lat: position.lat,
        lng: position.lng,
        confidence: keyframe.confidence,
        engaged: Boolean(position.engaged),
      });
    }
  }

  return formations
    .map((formation) => ({
      formationId: formation.id,
      side: formation.side,
      points: byFormation.get(formation.id) ?? [],
    }))
    .filter((track) => track.points.length > 0);
}

function buildTrailFeatures(
  tracks: Track[],
  selectedTime: number,
): FeatureCollection<LineString> {
  const features: Array<Feature<LineString>> = [];

  for (const track of tracks) {
    const points = track.points;

    if (points.length < 2) {
      continue;
    }

    const coordinates: Array<[number, number]> = [];
    let confidence: "documented" | "inferred" = "documented";

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (point.t > selectedTime) {
        if (index === 0) {
          break;
        }

        const prev = points[index - 1];
        const span = Math.max(1, point.t - prev.t);
        const blend = (selectedTime - prev.t) / span;
        coordinates.push([
          prev.lng + (point.lng - prev.lng) * blend,
          prev.lat + (point.lat - prev.lat) * blend,
        ]);
        confidence = point.confidence === "documented" && prev.confidence === "documented" ? confidence : "inferred";
        break;
      }

      coordinates.push([point.lng, point.lat]);
      if (point.confidence === "inferred") {
        confidence = "inferred";
      }
    }

    if (coordinates.length < 2) {
      continue;
    }

    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates,
      },
      properties: {
        formationId: track.formationId,
        side: track.side,
        confidence,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function buildTroopFeatures(
  formations: Formation[],
  positionsByFormation: Map<string, ReturnType<typeof interpolateFormationPositions>[number]>,
  selectedFormationId: string | null,
  offsetsByFormation: Map<string, Array<{ east: number; north: number }>>,
): FeatureCollection<Point> {
  const features: Array<Feature<Point>> = [];

  for (const formation of formations) {
    const position = positionsByFormation.get(formation.id);
    if (!position) {
      continue;
    }

    const offsets = offsetsByFormation.get(formation.id) ?? [];

    for (const offset of offsets) {
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [
            position.lng + metersToLng(offset.east, position.lat),
            position.lat + metersToLat(offset.north),
          ],
        },
        properties: {
          formationId: formation.id,
          formationName: formation.name,
          side: formation.side,
          selected: formation.id === selectedFormationId ? 1 : 0,
          confidence: position.confidence,
          uncertaintyMeters: position.uncertaintyMeters ?? 0,
        },
      });
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function buildAnchorFeatures(
  formations: Formation[],
  positionsByFormation: Map<string, ReturnType<typeof interpolateFormationPositions>[number]>,
  selectedFormationId: string | null,
): FeatureCollection<Point> {
  const features: Array<Feature<Point>> = [];

  for (const formation of formations) {
    const position = positionsByFormation.get(formation.id);
    if (!position) {
      continue;
    }

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [position.lng, position.lat],
      },
      properties: {
        formationId: formation.id,
        shortName: getShortName(formation.name),
        side: formation.side,
        selected: formation.id === selectedFormationId ? 1 : 0,
        confidence: position.confidence,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function buildLabelFeatures(labels: MapLabel[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: labels.map((label) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [label.lng, label.lat],
      },
      properties: {
        id: label.id,
        name: label.name,
        type: label.type,
        importance: label.importance,
        confidence: label.confidence,
      },
    })),
  };
}

function splitLayerPackFeatures(layerPack?: MapLayerPack): {
  lines: FeatureCollection<LineString>;
  points: FeatureCollection<Point>;
  polygons: FeatureCollection<Polygon>;
} {
  if (!layerPack) {
    return {
      lines: emptyLineCollection(),
      points: emptyPointCollection(),
      polygons: emptyPolygonCollection(),
    };
  }

  const lineFeatures: Array<MapLayerFeature & { geometry: LineString }> = [];
  const pointFeatures: Array<MapLayerFeature & { geometry: Point }> = [];
  const polygonFeatures: Array<MapLayerFeature & { geometry: Polygon }> = [];

  for (const feature of layerPack.features) {
    if (feature.geometry.type === "LineString") {
      lineFeatures.push(feature as MapLayerFeature & { geometry: LineString });
      continue;
    }

    if (feature.geometry.type === "Point") {
      pointFeatures.push(feature as MapLayerFeature & { geometry: Point });
      continue;
    }

    if (feature.geometry.type === "Polygon") {
      polygonFeatures.push(feature as MapLayerFeature & { geometry: Polygon });
    }
  }

  return {
    lines: {
      type: "FeatureCollection",
      features: lineFeatures,
    },
    points: {
      type: "FeatureCollection",
      features: pointFeatures,
    },
    polygons: {
      type: "FeatureCollection",
      features: polygonFeatures,
    },
  };
}

function buildFocusFeature(
  beat: NarrativeBeat | null,
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: beat
      ? [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [beat.cameraPose.lng, beat.cameraPose.lat],
            },
            properties: {
              id: beat.id,
              title: beat.title,
            },
          },
        ]
      : [],
  };
}

function addSourceIfMissing(map: MapboxMap, id: string, data: FeatureCollection<Geometry>) {
  if (!map.getSource(id)) {
    map.addSource(id, {
      type: "geojson",
      data,
    });
  }
}

function addLayersIfMissing(map: MapboxMap) {
  if (!map.getLayer("historic-polygons")) {
    map.addLayer({
      id: "historic-polygons",
      type: "fill",
      source: "historic-polygons",
      paint: {
        "fill-color": [
          "match",
          ["get", "styleKey"],
          "sector-contested",
          "#9f5f4a",
          "landmark-core",
          "#7d6b50",
          "#6a5b45",
        ],
        "fill-opacity": ["case", ["==", ["get", "confidence"], "inferred"], 0.18, 0.3],
      },
    });
  }

  if (!map.getLayer("historic-lines-casing")) {
    map.addLayer({
      id: "historic-lines-casing",
      type: "line",
      source: "historic-lines",
      paint: {
        "line-color": "#2a2118",
        "line-width": [
          "match",
          ["get", "styleKey"],
          "works-main",
          4.8,
          "river-main",
          4.1,
          "road-primary",
          3.1,
          2.6,
        ],
        "line-opacity": 0.42,
      },
    });
  }

  if (!map.getLayer("historic-lines")) {
    map.addLayer({
      id: "historic-lines",
      type: "line",
      source: "historic-lines",
      paint: {
        "line-color": [
          "match",
          ["get", "styleKey"],
          "works-main",
          "#6f89ad",
          "river-main",
          "#5982aa",
          "road-primary",
          "#cfb079",
          "#c7a472",
        ],
        "line-width": [
          "match",
          ["get", "styleKey"],
          "works-main",
          3.3,
          "river-main",
          2.8,
          "road-primary",
          2.2,
          1.8,
        ],
        "line-dasharray": ["case", ["==", ["get", "confidence"], "inferred"], [1.1, 1.1], [1, 0]],
        "line-opacity": 0.82,
      },
    });
  }

  if (!map.getLayer("historic-lines-highlight")) {
    map.addLayer({
      id: "historic-lines-highlight",
      type: "line",
      source: "historic-lines",
      paint: {
        "line-color": [
          "match",
          ["get", "styleKey"],
          "works-main",
          "#a9bfd8",
          "river-main",
          "#7ca5cb",
          "road-primary",
          "#f0d7a8",
          "#e6cb97",
        ],
        "line-width": [
          "match",
          ["get", "styleKey"],
          "works-main",
          1.1,
          "river-main",
          1,
          "road-primary",
          0.95,
          0.85,
        ],
        "line-opacity": ["case", ["==", ["get", "confidence"], "inferred"], 0.22, 0.5],
      },
    });
  }

  if (!map.getLayer("historic-landmarks")) {
    map.addLayer({
      id: "historic-landmarks",
      type: "circle",
      source: "historic-points",
      paint: {
        "circle-radius": ["match", ["get", "styleKey"], "landmark-primary", 5, 4],
        "circle-color": "#e5c992",
        "circle-stroke-width": 1.2,
        "circle-stroke-color": "#3d2d1e",
        "circle-opacity": ["case", ["==", ["get", "confidence"], "inferred"], 0.55, 0.9],
      },
    });
  }

  if (!map.getLayer("historic-feature-labels")) {
    map.addLayer({
      id: "historic-feature-labels",
      type: "symbol",
      source: "historic-points",
      layout: {
        "text-field": ["get", "name"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10.5, 15, 14],
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-offset": [0, 0.95],
        "text-anchor": "top",
        "symbol-sort-key": [
          "match",
          ["get", "styleKey"],
          "landmark-primary",
          9,
          4,
        ],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#f4e5c8",
        "text-halo-color": "#281f17",
        "text-halo-width": 1.35,
        "text-opacity": ["case", ["==", ["get", "confidence"], "inferred"], 0.66, 0.96],
      },
    });
  }

  if (!map.getLayer("battle-trails-shadow")) {
    map.addLayer({
      id: "battle-trails-shadow",
      type: "line",
      source: "battle-trails",
      paint: {
        "line-color": "#1b1712",
        "line-width": 4,
        "line-opacity": 0.28,
        "line-blur": 0.6,
      },
    });
  }

  if (!map.getLayer("battle-trails")) {
    map.addLayer({
      id: "battle-trails",
      type: "line",
      source: "battle-trails",
      paint: {
        "line-color": ["match", ["get", "side"], "Union", "#2f75c9", "#b0402f"],
        "line-width": 2.2,
        "line-opacity": 0.84,
        "line-dasharray": ["case", ["==", ["get", "confidence"], "inferred"], [1.1, 1], [1, 0]],
      },
    });
  }

  if (!map.getLayer("troop-uncertainty")) {
    map.addLayer({
      id: "troop-uncertainty",
      type: "circle",
      source: "troop-dots",
      paint: {
        "circle-radius": ["case", [">", ["get", "uncertaintyMeters"], 70], 6.7, 0],
        "circle-color": ["match", ["get", "side"], "Union", "#6f9fd7", "#d78a7e"],
        "circle-opacity": 0.14,
      },
    });
  }

  if (!map.getLayer("troop-dots")) {
    map.addLayer({
      id: "troop-dots",
      type: "circle",
      source: "troop-dots",
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 4.5, 3.2],
        "circle-color": ["match", ["get", "side"], "Union", "#2f75c9", "#b0402f"],
        "circle-opacity": ["case", ["==", ["get", "confidence"], "inferred"], 0.56, 0.92],
        "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 1.5, 0],
        "circle-stroke-color": "#fbe8b6",
        "circle-pitch-alignment": "viewport",
        "circle-pitch-scale": "viewport",
      },
    });
  }

  if (!map.getLayer("unit-anchors-hit")) {
    map.addLayer({
      id: "unit-anchors-hit",
      type: "circle",
      source: "unit-anchors",
      paint: {
        "circle-radius": 14,
        "circle-opacity": 0,
      },
    });
  }

  if (!map.getLayer("unit-labels")) {
    map.addLayer({
      id: "unit-labels",
      type: "symbol",
      source: "unit-anchors",
      layout: {
        "text-field": ["case", ["==", ["get", "selected"], 1], ["get", "shortName"], ""],
        "text-size": 12,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-offset": [0, 1.25],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-pitch-alignment": "viewport",
        "text-rotation-alignment": "viewport",
      },
      paint: {
        "text-color": "#f5ead5",
        "text-halo-color": "#17120e",
        "text-halo-width": 1.35,
      },
    });
  }

  if (!map.getLayer("battle-labels")) {
    map.addLayer({
      id: "battle-labels",
      type: "symbol",
      source: "battle-labels",
      layout: {
        "text-field": ["get", "name"],
        "text-size": ["interpolate", ["linear"], ["get", "importance"], 1, 9, 5, 14.8],
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-offset": [0, 0.95],
        "symbol-sort-key": ["get", "importance"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-pitch-alignment": "viewport",
        "text-rotation-alignment": "viewport",
      },
      paint: {
        "text-color": [
          "interpolate",
          ["linear"],
          ["get", "importance"],
          1,
          "#d8c2a1",
          5,
          "#f9ecd1",
        ],
        "text-halo-color": "#2f261d",
        "text-halo-width": 1.5,
        "text-opacity": 0.94,
      },
    });
  }

  if (!map.getLayer("focus-ring")) {
    map.addLayer({
      id: "focus-ring",
      type: "circle",
      source: "focus-beat",
      paint: {
        "circle-radius": 24,
        "circle-color": "#000000",
        "circle-opacity": 0,
        "circle-stroke-color": "#f3d79f",
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0.9,
      },
    });
  }
}

function applyModeStyling(map: MapboxMap, mode: MapMode) {
  map.setFog(MAP_MODE_FOG[mode]);

  map.setTerrain({
    source: "battlefield-dem",
    exaggeration: mode === "reconstructed" ? 1.03 : 1.08,
  });

  if (map.getLayer("battle-labels")) {
    map.setPaintProperty("battle-labels", "text-opacity", mode === "reconstructed" ? 0.99 : 0.85);
  }

  if (map.getLayer("historic-feature-labels")) {
    map.setPaintProperty(
      "historic-feature-labels",
      "text-opacity",
      mode === "reconstructed" ? 0.95 : 0.45,
    );
  }

  if (map.getLayer("historic-polygons")) {
    map.setPaintProperty("historic-polygons", "fill-opacity", mode === "reconstructed" ? 0.3 : 0.12);
  }

  if (map.getLayer("historic-lines-casing")) {
    map.setPaintProperty("historic-lines-casing", "line-opacity", mode === "reconstructed" ? 0.42 : 0.2);
  }

  if (map.getLayer("historic-lines")) {
    map.setPaintProperty("historic-lines", "line-opacity", mode === "reconstructed" ? 0.86 : 0.46);
  }

  if (map.getLayer("historic-lines-highlight")) {
    map.setPaintProperty("historic-lines-highlight", "line-opacity", mode === "reconstructed" ? 0.46 : 0.18);
  }

  if (map.getLayer("battle-trails")) {
    map.setPaintProperty("battle-trails", "line-opacity", mode === "reconstructed" ? 0.84 : 0.72);
  }
}

function resolveBeat(
  activeBeatId: string | null,
  narrativeBeats: NarrativeBeat[],
): NarrativeBeat | null {
  if (!activeBeatId) {
    return null;
  }

  return narrativeBeats.find((beat) => beat.id === activeBeatId) ?? null;
}

function resolveChapter(chapters: ChapterScene[] | undefined, activeChapterId: string | null | undefined): ChapterScene | null {
  if (!chapters || !activeChapterId) {
    return null;
  }

  return chapters.find((chapter) => chapter.id === activeChapterId) ?? null;
}

function resolveChapterCameraPose(chapter: ChapterScene, selectedTime: number): {
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
} | null {
  if (chapter.cameraRail.length === 0) {
    return null;
  }

  if (chapter.cameraRail.length === 1) {
    return chapter.cameraRail[0];
  }

  const chapterStart = Date.parse(chapter.startTime);
  const targetOffset = Math.max(0, selectedTime - chapterStart);

  let left = chapter.cameraRail[0];
  let right = chapter.cameraRail[chapter.cameraRail.length - 1];

  for (let index = 0; index < chapter.cameraRail.length - 1; index += 1) {
    const current = chapter.cameraRail[index];
    const next = chapter.cameraRail[index + 1];

    if (targetOffset >= current.timeOffsetMs && targetOffset <= next.timeOffsetMs) {
      left = current;
      right = next;
      break;
    }
  }

  const span = Math.max(1, right.timeOffsetMs - left.timeOffsetMs);
  const blend = Math.max(0, Math.min(1, (targetOffset - left.timeOffsetMs) / span));

  return {
    lat: left.lat + (right.lat - left.lat) * blend,
    lng: left.lng + (right.lng - left.lng) * blend,
    zoom: left.zoom + (right.zoom - left.zoom) * blend,
    pitch: left.pitch + (right.pitch - left.pitch) * blend,
    bearing: left.bearing + (right.bearing - left.bearing) * blend,
  };
}

export default function PresentDayMapbox({
  manifest,
  formations,
  movementKeyframes,
  mapLabels,
  narrativeBeats,
  chapters,
  mapLayerPack,
  selectedTime,
  activeBeatId,
  activeChapterId,
  guidedMode,
  selectedFormationId,
  mapMode,
  lockedFormationId,
  reducedMotion = false,
  onSelectFormation,
}: PresentDayMapboxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapReadyRef = useRef(false);
  const activeMapModeRef = useRef<MapMode>(mapMode ?? "modern");
  const onSelectRef = useRef<(formationId: string | null) => void>(() => {});
  const lastGuidedCameraUpdateRef = useRef<number>(0);
  const focusPulseRafRef = useRef<number | null>(null);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();

  const normalizedMapMode: MapMode = mapMode ?? "modern";

  useEffect(() => {
    onSelectRef.current = (formationId) => {
      onSelectFormation?.(formationId);
    };
  }, [onSelectFormation]);

  const tracks = useMemo(() => buildTracks(formations, movementKeyframes), [formations, movementKeyframes]);

  const offsetsByFormation = useMemo(() => {
    const map = new Map<string, Array<{ east: number; north: number }>>();
    for (const formation of formations) {
      map.set(formation.id, buildFormationOffsets(troopDotCount(formation.strengthEstimate)));
    }
    return map;
  }, [formations]);

  const positionsByFormation = useMemo(() => {
    const interpolated = interpolateFormationPositions(selectedTime, movementKeyframes);
    return new Map(interpolated.map((position) => [position.formationId, position]));
  }, [movementKeyframes, selectedTime]);

  const dynamicTrailFeatures = useMemo(
    () => buildTrailFeatures(tracks, selectedTime),
    [selectedTime, tracks],
  );

  const troopDots = useMemo(
    () => buildTroopFeatures(formations, positionsByFormation, selectedFormationId ?? null, offsetsByFormation),
    [formations, offsetsByFormation, positionsByFormation, selectedFormationId],
  );

  const anchors = useMemo(
    () => buildAnchorFeatures(formations, positionsByFormation, selectedFormationId ?? null),
    [formations, positionsByFormation, selectedFormationId],
  );

  const labelFeatures = useMemo(() => buildLabelFeatures(mapLabels), [mapLabels]);
  const splitMapLayers = useMemo(() => splitLayerPackFeatures(mapLayerPack), [mapLayerPack]);
  const activeBeat = useMemo(() => resolveBeat(activeBeatId, narrativeBeats), [activeBeatId, narrativeBeats]);
  const activeChapter = useMemo(() => resolveChapter(chapters, activeChapterId), [activeChapterId, chapters]);
  const focusFeature = useMemo(() => buildFocusFeature(activeBeat), [activeBeat]);

  // Latest render data, readable from long-lived map callbacks without
  // retriggering the init effect (recreating the map every frame was the old
  // failure mode here).
  const latestRef = useRef({
    labelFeatures,
    splitMapLayers,
    dynamicTrailFeatures,
    troopDots,
    anchors,
    focusFeature,
    bounds: manifest.bounds,
  });
  latestRef.current = {
    labelFeatures,
    splitMapLayers,
    dynamicTrailFeatures,
    troopDots,
    anchors,
    focusFeature,
    bounds: manifest.bounds,
  };

  useEffect(() => {
    if (!mapboxToken || !containerRef.current || mapRef.current) {
      return;
    }

    let cancelled = false;

    const init = async () => {
      const mapbox = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) {
        return;
      }

      mapbox.accessToken = mapboxToken;

      const initialBounds = latestRef.current.bounds;
      const centerLat = (initialBounds.north + initialBounds.south) / 2;
      const centerLng = (initialBounds.east + initialBounds.west) / 2;

      const map = new mapbox.Map({
        container: containerRef.current,
        style: STYLE_BY_MODE[normalizedMapMode],
        center: [centerLng, centerLat],
        zoom: 13.7,
        pitch: normalizedMapMode === "reconstructed" ? 42 : 45,
        bearing: -17,
        antialias: true,
        cooperativeGestures: true,
      });

      map.addControl(new mapbox.NavigationControl({ visualizePitch: true }), "top-right");
      map.addControl(new mapbox.ScaleControl({ unit: "imperial" }), "bottom-right");

      const hydrateSourcesAndLayers = () => {
        if (!map.getSource("battlefield-dem")) {
          map.addSource("battlefield-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
        }

        addSourceIfMissing(map, "battle-trails", emptyLineCollection());
        addSourceIfMissing(map, "troop-dots", emptyPointCollection());
        addSourceIfMissing(map, "unit-anchors", emptyPointCollection());
        addSourceIfMissing(map, "battle-labels", emptyPointCollection());
        addSourceIfMissing(map, "focus-beat", emptyPointCollection());
        addSourceIfMissing(map, "historic-lines", emptyLineCollection());
        addSourceIfMissing(map, "historic-points", emptyPointCollection());
        addSourceIfMissing(map, "historic-polygons", emptyPolygonCollection());

        addLayersIfMissing(map);

        const latest = latestRef.current;
        setSourceData(map, "battle-labels", latest.labelFeatures);
        setSourceData(map, "historic-lines", latest.splitMapLayers.lines);
        setSourceData(map, "historic-points", latest.splitMapLayers.points);
        setSourceData(map, "historic-polygons", latest.splitMapLayers.polygons);
        setSourceData(map, "battle-trails", latest.dynamicTrailFeatures);
        setSourceData(map, "troop-dots", latest.troopDots);
        setSourceData(map, "unit-anchors", latest.anchors);
        setSourceData(map, "focus-beat", latest.focusFeature);

        applyModeStyling(map, activeMapModeRef.current);
      };

      map.on("load", () => {
        mapReadyRef.current = true;
        hydrateSourcesAndLayers();

        map.on("style.load", () => {
          if (!mapReadyRef.current) {
            return;
          }

          hydrateSourcesAndLayers();
        });

        map.on("click", "unit-anchors-hit", (event) => {
          const formationId = event.features?.[0]?.properties?.formationId;
          onSelectRef.current(typeof formationId === "string" ? formationId : null);
        });

        map.on("mouseenter", "unit-anchors-hit", () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", "unit-anchors-hit", () => {
          map.getCanvas().style.cursor = "";
        });

        map.on("click", (event) => {
          const isUnitClick = map.queryRenderedFeatures(event.point, {
            layers: ["unit-anchors-hit"],
          }).length;

          if (!isUnitClick) {
            onSelectRef.current(null);
          }
        });

        const fitTo = latestRef.current.bounds;
        const bounds: [[number, number], [number, number]] = [
          [fitTo.west, fitTo.south],
          [fitTo.east, fitTo.north],
        ];

        map.fitBounds(bounds, {
          duration: 0,
          padding: { top: 50, right: 50, bottom: 50, left: 50 },
          maxZoom: 14.95,
        });
      });

      mapRef.current = map;
    };

    void init();

    return () => {
      cancelled = true;
      mapReadyRef.current = false;
      if (focusPulseRafRef.current !== null) {
        cancelAnimationFrame(focusPulseRafRef.current);
      }
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is created once per token; live data flows in via the update
    // effects below and latestRef, never by re-initializing the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken]);

  useEffect(() => {
    if (!mapRef.current || !mapReadyRef.current) {
      return;
    }

    if (normalizedMapMode === activeMapModeRef.current) {
      applyModeStyling(mapRef.current, normalizedMapMode);
      return;
    }

    activeMapModeRef.current = normalizedMapMode;
    mapRef.current.setStyle(STYLE_BY_MODE[normalizedMapMode]);
  }, [normalizedMapMode]);

  useEffect(() => {
    if (!mapRef.current || !mapReadyRef.current) {
      return;
    }

    setSourceData(mapRef.current, "battle-trails", dynamicTrailFeatures);
    setSourceData(mapRef.current, "troop-dots", troopDots);
    setSourceData(mapRef.current, "unit-anchors", anchors);
    setSourceData(mapRef.current, "focus-beat", focusFeature);
  }, [anchors, dynamicTrailFeatures, focusFeature, troopDots]);

  useEffect(() => {
    if (!mapRef.current || !mapReadyRef.current) {
      return;
    }

    setSourceData(mapRef.current, "battle-labels", labelFeatures);
    setSourceData(mapRef.current, "historic-lines", splitMapLayers.lines);
    setSourceData(mapRef.current, "historic-points", splitMapLayers.points);
    setSourceData(mapRef.current, "historic-polygons", splitMapLayers.polygons);
  }, [labelFeatures, splitMapLayers.lines, splitMapLayers.points, splitMapLayers.polygons]);

  useEffect(() => {
    if (!mapRef.current || !guidedMode) {
      return;
    }

    const map = mapRef.current;

    if (lockedFormationId) {
      const lockPosition = positionsByFormation.get(lockedFormationId);
      if (!lockPosition) {
        return;
      }

      map.easeTo({
        center: [lockPosition.lng, lockPosition.lat],
        duration: reducedMotion ? 0 : 280,
        essential: true,
      });
      return;
    }

    const chapterPose = activeChapter ? resolveChapterCameraPose(activeChapter, selectedTime) : null;
    if (chapterPose) {
      const now = performance.now();
      if (reducedMotion || now - lastGuidedCameraUpdateRef.current >= 450) {
        lastGuidedCameraUpdateRef.current = now;
        map.easeTo({
          center: [chapterPose.lng, chapterPose.lat],
          zoom: chapterPose.zoom,
          pitch: chapterPose.pitch,
          bearing: chapterPose.bearing,
          duration: reducedMotion ? 0 : 420,
          essential: true,
        });
      }
      return;
    }

    if (activeBeat) {
      map.flyTo({
        center: [activeBeat.cameraPose.lng, activeBeat.cameraPose.lat],
        zoom: 14.7,
        pitch: Math.min(64, Math.max(42, activeBeat.cameraPose.pitch + 16)),
        bearing: activeBeat.cameraPose.yaw,
        duration: reducedMotion ? 0 : 1200,
        essential: true,
      });
    }
  }, [
    activeBeat,
    activeChapter,
    guidedMode,
    lockedFormationId,
    positionsByFormation,
    reducedMotion,
    selectedTime,
  ]);

  useEffect(() => {
    if (!mapRef.current || !mapReadyRef.current) {
      return;
    }

    if (focusPulseRafRef.current !== null) {
      cancelAnimationFrame(focusPulseRafRef.current);
      focusPulseRafRef.current = null;
    }

    if (!guidedMode || reducedMotion) {
      mapRef.current.setPaintProperty("focus-ring", "circle-stroke-opacity", 0.88);
      mapRef.current.setPaintProperty("focus-ring", "circle-radius", 24);
      return;
    }

    const animate = (time: number) => {
      if (!mapRef.current) {
        return;
      }

      const pulse = 24 + Math.sin(time / 420) * 5;
      const opacity = 0.68 + Math.sin(time / 380) * 0.18;

      if (mapRef.current.getLayer("focus-ring")) {
        mapRef.current.setPaintProperty("focus-ring", "circle-radius", pulse);
        mapRef.current.setPaintProperty("focus-ring", "circle-stroke-opacity", opacity);
      }

      focusPulseRafRef.current = requestAnimationFrame(animate);
    };

    focusPulseRafRef.current = requestAnimationFrame(animate);

    return () => {
      if (focusPulseRafRef.current !== null) {
        cancelAnimationFrame(focusPulseRafRef.current);
        focusPulseRafRef.current = null;
      }
    };
  }, [guidedMode, reducedMotion]);

  if (!mapboxToken) {
    return (
      <div className="mapbox-empty" data-testid="present-day-map-empty">
        <h3>Mapbox token needed for battle timelapse mode</h3>
        <p>
          Add <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> to your environment, then reload to enable
          the full historical timelapse map.
        </p>
      </div>
    );
  }

  return (
    <div className={`present-map-wrap ${normalizedMapMode}`}>
      <div ref={containerRef} className="present-map" data-testid="present-day-map" />
    </div>
  );
}
