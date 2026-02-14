"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { Map as MapboxMap, Marker } from "mapbox-gl";

import { interpolateUnitPositions } from "@/lib/battle/interpolation";
import type {
  BattleManifest,
  DivisionUnit,
  MapLabel,
  TimeSlice,
} from "@/lib/battle/types";

interface PresentDayMapboxProps {
  manifest: BattleManifest;
  units: DivisionUnit[];
  mapLabels: MapLabel[];
  timeSlices: TimeSlice[];
  selectedTime: number;
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string | null) => void;
}

function getShortName(value: string): string {
  return value
    .replace("'s Division", "")
    .replace(" Division", "")
    .replace(" (XXIII Corps)", "")
    .replace(" (IV Corps)", "");
}

function clearMarkers(markerRef: MutableRefObject<Marker[]>) {
  markerRef.current.forEach((marker) => marker.remove());
  markerRef.current = [];
}

export default function PresentDayMapbox({
  manifest,
  units,
  mapLabels,
  timeSlices,
  selectedTime,
  selectedUnitId,
  onSelectUnit,
}: PresentDayMapboxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerApiRef = useRef<(typeof import("mapbox-gl"))["default"] | null>(null);
  const unitMarkersRef = useRef<Marker[]>([]);
  const landmarkMarkersRef = useRef<Marker[]>([]);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();

  const positionsByUnit = useMemo(() => {
    const interpolated = interpolateUnitPositions(selectedTime, timeSlices);
    return new Map(interpolated.map((position) => [position.unitId, position]));
  }, [selectedTime, timeSlices]);

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

      markerApiRef.current = mapbox;
      mapbox.accessToken = mapboxToken;

      const centerLat = (manifest.bounds.north + manifest.bounds.south) / 2;
      const centerLng = (manifest.bounds.east + manifest.bounds.west) / 2;

      const map = new mapbox.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/standard",
        center: [centerLng, centerLat],
        zoom: 13.6,
        pitch: 56,
        bearing: -16,
        antialias: true,
      });

      map.addControl(new mapbox.NavigationControl({ visualizePitch: true }), "top-right");
      map.addControl(new mapbox.ScaleControl({ unit: "imperial" }), "bottom-right");

      map.on("load", () => {
        const bounds: [[number, number], [number, number]] = [
          [manifest.bounds.west, manifest.bounds.south],
          [manifest.bounds.east, manifest.bounds.north],
        ];

        if (!map.getSource("battlefield-dem")) {
          map.addSource("battlefield-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
        }

        map.setTerrain({ source: "battlefield-dem", exaggeration: 1.25 });
        map.fitBounds(bounds, {
          duration: 0,
          padding: {
            top: 40,
            right: 40,
            bottom: 40,
            left: 40,
          },
          maxZoom: 14.8,
        });
      });

      mapRef.current = map;
    };

    void init();

    return () => {
      cancelled = true;
      clearMarkers(unitMarkersRef);
      clearMarkers(landmarkMarkersRef);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [manifest.bounds.east, manifest.bounds.north, manifest.bounds.south, manifest.bounds.west, mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    const api = markerApiRef.current;

    if (!map || !api) {
      return;
    }

    clearMarkers(unitMarkersRef);
    clearMarkers(landmarkMarkersRef);

    for (const label of mapLabels) {
      const element = document.createElement("div");
      element.className = `present-landmark-marker importance-${Math.min(5, Math.max(1, label.importance))}`;
      element.textContent = label.name;

      const marker = new api.Marker({
        element,
        anchor: "left",
      })
        .setLngLat([label.lng, label.lat])
        .setPopup(
          new api.Popup({ closeButton: false, offset: 10 }).setHTML(
            `<strong>${label.name}</strong><br/><small>${label.type.replace("-", " ")}</small>`,
          ),
        )
        .addTo(map);

      landmarkMarkersRef.current.push(marker);
    }

    for (const unit of units) {
      const position = positionsByUnit.get(unit.id);
      if (!position) {
        continue;
      }

      const element = document.createElement("button");
      const selected = selectedUnitId === unit.id;
      element.type = "button";
      element.className = `present-unit-marker ${unit.side.toLowerCase()} ${selected ? "selected" : ""}`;
      element.innerHTML = `<span class="dot"></span><span class="tag">${getShortName(unit.name)}</span>`;
      element.setAttribute("aria-label", `Select ${unit.name}`);
      element.addEventListener("click", () => onSelectUnit(unit.id));

      const marker = new api.Marker({
        element,
        anchor: "center",
      })
        .setLngLat([position.lng, position.lat])
        .setPopup(
          new api.Popup({ offset: 12 }).setHTML(
            `<strong>${unit.name}</strong><br/>${unit.commander}<br/><small>${unit.strengthEstimate.toLocaleString()} personnel</small>`,
          ),
        )
        .addTo(map);

      unitMarkersRef.current.push(marker);
    }
  }, [mapLabels, onSelectUnit, positionsByUnit, selectedUnitId, units]);

  if (!mapboxToken) {
    return (
      <div className="mapbox-empty" data-testid="present-day-map-empty">
        <h3>Mapbox token needed for present-day mode</h3>
        <p>
          Add <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> to your environment, then reload to enable
          live modern map + business POI context.
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="present-map" data-testid="present-day-map" />;
}
