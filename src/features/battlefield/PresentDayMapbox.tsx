"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
} from "geojson";
import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";

import { interpolateUnitPositions } from "@/lib/battle/interpolation";
import type {
  BattleManifest,
  DivisionUnit,
  MapLabel,
  NarrativeBeat,
  TimeSlice,
} from "@/lib/battle/types";

export type MapTheme = "historical" | "modern";

interface PresentDayMapboxProps {
  manifest: BattleManifest;
  units: DivisionUnit[];
  mapLabels: MapLabel[];
  narrativeBeats: NarrativeBeat[];
  timeSlices: TimeSlice[];
  selectedTime: number;
  activeBeatId: string | null;
  guidedMode: boolean;
  selectedUnitId: string | null;
  mapTheme: MapTheme;
  onSelectUnit: (unitId: string | null) => void;
}

const HISTORICAL_BASEMAP_CONFIG = {
  theme: "faded",
  lightPreset: "dusk",
  showRoadsAndTransit: false,
  showPlaceLabels: false,
  showPointOfInterestLabels: false,
  show3dObjects: false,
};

const MODERN_BASEMAP_CONFIG = {
  theme: "default",
  lightPreset: "day",
  showRoadsAndTransit: true,
  showPlaceLabels: true,
  showPointOfInterestLabels: true,
  show3dObjects: true,
};

function getBasemapConfig(mapTheme: MapTheme) {
  return mapTheme === "historical" ? HISTORICAL_BASEMAP_CONFIG : MODERN_BASEMAP_CONFIG;
}

function applyMapTheme(map: MapboxMap, mapTheme: MapTheme) {
  map.setConfig("basemap", getBasemapConfig(mapTheme));

  map.setTerrain({
    source: "battlefield-dem",
    exaggeration: mapTheme === "historical" ? 1.03 : 1.07,
  });

  map.setFog({
    color: mapTheme === "historical" ? "#cab08a" : "#cad5df",
    "high-color": mapTheme === "historical" ? "#e6d0aa" : "#dde7ef",
    "horizon-blend": mapTheme === "historical" ? 0.28 : 0.2,
    "space-color": mapTheme === "historical" ? "#d8c4a5" : "#dfe8f0",
  });

  if (map.getLayer("historic-lines")) {
    map.setPaintProperty("historic-lines", "line-opacity", mapTheme === "historical" ? 0.88 : 0.56);
  }

  if (map.getLayer("battle-labels")) {
    map.setPaintProperty("battle-labels", "text-opacity", mapTheme === "historical" ? 0.98 : 0.86);
  }

  map.easeTo({
    pitch: mapTheme === "historical" ? 38 : 45,
    duration: 420,
    essential: true,
  });
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

function setSourceData<T extends Point | LineString>(
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

function buildTroopFeatures(
  units: DivisionUnit[],
  positionsByUnit: Map<string, ReturnType<typeof interpolateUnitPositions>[number]>,
  selectedUnitId: string | null,
): FeatureCollection<Point> {
  const features: Array<Feature<Point>> = [];

  for (const unit of units) {
    const position = positionsByUnit.get(unit.id);
    if (!position) {
      continue;
    }

    const dotCount = troopDotCount(unit.strengthEstimate);
    const offsets = buildFormationOffsets(dotCount);

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
          unitId: unit.id,
          unitName: unit.name,
          side: unit.side,
          selected: unit.id === selectedUnitId ? 1 : 0,
          confidence: position.confidence,
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
  units: DivisionUnit[],
  positionsByUnit: Map<string, ReturnType<typeof interpolateUnitPositions>[number]>,
  selectedUnitId: string | null,
): FeatureCollection<Point> {
  const features: Array<Feature<Point>> = [];

  for (const unit of units) {
    const position = positionsByUnit.get(unit.id);
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
        unitId: unit.id,
        shortName: getShortName(unit.name),
        side: unit.side,
        selected: unit.id === selectedUnitId ? 1 : 0,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function buildTrailFeatures(
  units: DivisionUnit[],
  timeSlices: TimeSlice[],
  selectedTime: number,
): FeatureCollection<LineString> {
  const ordered = [...timeSlices].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const byUnit = new Map<string, Array<[number, number]>>();

  for (const unit of units) {
    byUnit.set(unit.id, []);
  }

  for (const timeSlice of ordered) {
    const time = Date.parse(timeSlice.timestamp);
    if (time > selectedTime) {
      break;
    }

    for (const position of timeSlice.unitPositions) {
      byUnit.get(position.unitId)?.push([position.lng, position.lat]);
    }
  }

  const features: Array<Feature<LineString>> = [];

  for (const unit of units) {
    const coordinates = byUnit.get(unit.id) ?? [];
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
        unitId: unit.id,
        side: unit.side,
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
      },
    })),
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

function buildHistoricLineFeatures(): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-86.8598, 35.9093],
            [-86.8596, 35.9152],
            [-86.8593, 35.9208],
            [-86.8596, 35.925],
          ],
        },
        properties: {
          type: "road-1864",
          name: "Columbia Pike (1864 axis)",
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-86.874, 35.9222],
            [-86.8696, 35.9225],
            [-86.8654, 35.9226],
            [-86.8614, 35.9224],
            [-86.8572, 35.9222],
            [-86.8528, 35.9231],
          ],
        },
        properties: {
          type: "union-works",
          name: "Federal Main Works",
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-86.8622, 35.9097],
            [-86.8611, 35.9148],
            [-86.8601, 35.9184],
            [-86.8596, 35.9219],
          ],
        },
        properties: {
          type: "assault-axis",
          name: "Cheatham Assault Axis",
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-86.8684, 35.9082],
            [-86.8661, 35.9138],
            [-86.8639, 35.919],
            [-86.8621, 35.9221],
          ],
        },
        properties: {
          type: "assault-axis",
          name: "Brown-Cleburne Axis",
        },
      },
    ],
  };
}

export default function PresentDayMapbox({
  manifest,
  units,
  mapLabels,
  narrativeBeats,
  timeSlices,
  selectedTime,
  activeBeatId,
  guidedMode,
  selectedUnitId,
  mapTheme,
  onSelectUnit,
}: PresentDayMapboxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapReadyRef = useRef(false);
  const previousBeatRef = useRef<string | null>(null);
  const onSelectUnitRef = useRef(onSelectUnit);
  const mapThemeRef = useRef(mapTheme);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();

  useEffect(() => {
    onSelectUnitRef.current = onSelectUnit;
  }, [onSelectUnit]);

  useEffect(() => {
    mapThemeRef.current = mapTheme;
  }, [mapTheme]);

  const positionsByUnit = useMemo(() => {
    const interpolated = interpolateUnitPositions(selectedTime, timeSlices);
    return new Map(interpolated.map((position) => [position.unitId, position]));
  }, [selectedTime, timeSlices]);

  const troopDots = useMemo(
    () => buildTroopFeatures(units, positionsByUnit, selectedUnitId),
    [positionsByUnit, selectedUnitId, units],
  );

  const unitAnchors = useMemo(
    () => buildAnchorFeatures(units, positionsByUnit, selectedUnitId),
    [positionsByUnit, selectedUnitId, units],
  );

  const trails = useMemo(
    () => buildTrailFeatures(units, timeSlices, selectedTime),
    [selectedTime, timeSlices, units],
  );

  const labels = useMemo(() => buildLabelFeatures(mapLabels), [mapLabels]);
  const historicLines = useMemo(() => buildHistoricLineFeatures(), []);

  const activeBeat = useMemo(
    () => narrativeBeats.find((beat) => beat.id === activeBeatId) ?? null,
    [activeBeatId, narrativeBeats],
  );

  const focus = useMemo(() => buildFocusFeature(activeBeat), [activeBeat]);

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

      const centerLat = (manifest.bounds.north + manifest.bounds.south) / 2;
      const centerLng = (manifest.bounds.east + manifest.bounds.west) / 2;

      const map = new mapbox.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/standard-satellite",
        config: { basemap: getBasemapConfig(mapThemeRef.current) },
        center: [centerLng, centerLat],
        zoom: 13.6,
        pitch: 40,
        bearing: -18,
        antialias: true,
        cooperativeGestures: true,
      });

      map.addControl(new mapbox.NavigationControl({ visualizePitch: true }), "top-right");
      map.addControl(new mapbox.ScaleControl({ unit: "imperial" }), "bottom-right");

      map.on("load", () => {
        mapReadyRef.current = true;

        if (!map.getSource("battlefield-dem")) {
          map.addSource("battlefield-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
        }

        applyMapTheme(map, mapThemeRef.current);

        map.addSource("battle-trails", {
          type: "geojson",
          data: emptyLineCollection(),
        });

        map.addSource("troop-dots", {
          type: "geojson",
          data: emptyPointCollection(),
        });

        map.addSource("unit-anchors", {
          type: "geojson",
          data: emptyPointCollection(),
        });

        map.addSource("battle-labels", {
          type: "geojson",
          data: emptyPointCollection(),
        });

        map.addSource("focus-beat", {
          type: "geojson",
          data: emptyPointCollection(),
        });

        map.addSource("historic-lines", {
          type: "geojson",
          data: emptyLineCollection(),
        });

        map.addLayer({
          id: "historic-lines",
          type: "line",
          source: "historic-lines",
          paint: {
            "line-color": [
              "match",
              ["get", "type"],
              "union-works",
              "#7a9bc1",
              "assault-axis",
              "#b14e3e",
              "#cfb079",
            ],
            "line-width": [
              "match",
              ["get", "type"],
              "union-works",
              3,
              "assault-axis",
              2.7,
              2,
            ],
            "line-dasharray": [
              "match",
              ["get", "type"],
              "assault-axis",
              [1.3, 1],
              "road-1864",
              [0.6, 1.2],
              [1, 0],
            ],
            "line-opacity": 0.84,
          },
        });

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

        map.addLayer({
          id: "battle-trails",
          type: "line",
          source: "battle-trails",
          paint: {
            "line-color": [
              "match",
              ["get", "side"],
              "Union",
              "#2f75c9",
              "#b0402f",
            ],
            "line-width": 2.1,
            "line-opacity": 0.8,
          },
        });

        map.addLayer({
          id: "troop-dots",
          type: "circle",
          source: "troop-dots",
          paint: {
            "circle-radius": ["case", ["==", ["get", "selected"], 1], 4.3, 3.1],
            "circle-color": [
              "match",
              ["get", "side"],
              "Union",
              "#2f75c9",
              "#b0402f",
            ],
            "circle-opacity": ["case", ["==", ["get", "confidence"], "inferred"], 0.56, 0.9],
            "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 1.6, 0],
            "circle-stroke-color": "#fbe8b6",
            "circle-pitch-alignment": "viewport",
            "circle-pitch-scale": "viewport",
          },
        });

        map.addLayer({
          id: "unit-anchors-hit",
          type: "circle",
          source: "unit-anchors",
          paint: {
            "circle-radius": 14,
            "circle-opacity": 0,
          },
        });

        map.addLayer({
          id: "unit-labels",
          type: "symbol",
          source: "unit-anchors",
          layout: {
            "text-field": [
              "case",
              ["==", ["get", "selected"], 1],
              ["get", "shortName"],
              "",
            ],
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

        map.addLayer({
          id: "battle-labels",
          type: "symbol",
          source: "battle-labels",
          layout: {
            "text-field": ["get", "name"],
            "text-size": ["interpolate", ["linear"], ["get", "importance"], 1, 10, 5, 14],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-offset": [0, 0.95],
            "symbol-sort-key": ["get", "importance"],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
          },
          paint: {
            "text-color": "#f9ecd1",
            "text-halo-color": "#2f261d",
            "text-halo-width": 1.5,
            "text-opacity": 0.95,
          },
        });

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
            "circle-stroke-opacity": 0.88,
          },
        });

        map.on("click", "unit-anchors-hit", (event) => {
          const unitId = event.features?.[0]?.properties?.unitId;
          onSelectUnitRef.current(typeof unitId === "string" ? unitId : null);
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
            onSelectUnitRef.current(null);
          }
        });

        const bounds: [[number, number], [number, number]] = [
          [manifest.bounds.west, manifest.bounds.south],
          [manifest.bounds.east, manifest.bounds.north],
        ];

        map.fitBounds(bounds, {
          duration: 0,
          padding: { top: 50, right: 50, bottom: 50, left: 50 },
          maxZoom: 14.9,
        });
      });

      mapRef.current = map;
    };

    void init();

    return () => {
      cancelled = true;
      mapReadyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
      previousBeatRef.current = null;
    };
  }, [
    manifest.bounds.east,
    manifest.bounds.north,
    manifest.bounds.south,
    manifest.bounds.west,
    mapboxToken,
  ]);

  useEffect(() => {
    if (!mapRef.current || !mapReadyRef.current) {
      return;
    }

    applyMapTheme(mapRef.current, mapTheme);
  }, [mapTheme]);

  useEffect(() => {
    if (!mapRef.current || !mapReadyRef.current) {
      return;
    }

    setSourceData(mapRef.current, "battle-trails", trails);
    setSourceData(mapRef.current, "troop-dots", troopDots);
    setSourceData(mapRef.current, "unit-anchors", unitAnchors);
    setSourceData(mapRef.current, "battle-labels", labels);
    setSourceData(mapRef.current, "focus-beat", focus);
    setSourceData(mapRef.current, "historic-lines", historicLines);
  }, [focus, historicLines, labels, trails, troopDots, unitAnchors]);

  useEffect(() => {
    if (!mapRef.current || !guidedMode || !activeBeat || previousBeatRef.current === activeBeat.id) {
      return;
    }

    previousBeatRef.current = activeBeat.id;

    mapRef.current.flyTo({
      center: [activeBeat.cameraPose.lng, activeBeat.cameraPose.lat],
      zoom: 14.7,
      pitch: Math.min(62, Math.max(42, activeBeat.cameraPose.pitch + 18)),
      bearing: activeBeat.cameraPose.yaw,
      duration: 1800,
      essential: true,
    });
  }, [activeBeat, guidedMode]);

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
    <div className="present-map-wrap">
      <div ref={containerRef} className="present-map" data-testid="present-day-map" />
      <div className={`historic-map-overlay ${mapTheme}`} aria-hidden="true" />
    </div>
  );
}
