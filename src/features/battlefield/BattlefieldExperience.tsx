"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import NarrativeMode from "@/features/battlefield/NarrativeMode";
import PresentDayMapbox from "@/features/battlefield/PresentDayMapbox";
import Scene from "@/features/battlefield/Scene";
import TimelineControls from "@/features/battlefield/TimelineControls";
import { getConfidenceStyle, interpolateUnitPositions } from "@/lib/battle/interpolation";
import {
  resolveActiveTimelineEvent,
  useBattleStore,
  type PlaybackSpeed,
} from "@/lib/battle/store";
import type {
  BattleDataBundle,
  BattleManifest,
  DivisionUnit,
  MapLabel,
  NarrativeBeat,
  SourceCitation,
  TerrainDem,
  TimeSlice,
  TimelineEvent,
} from "@/lib/battle/types";
import { validateBattleData } from "@/lib/battle/validation";

interface DivisionsPayload {
  units: DivisionUnit[];
  timeSlices: TimeSlice[];
}

interface EventsPayload {
  narrativeBeats: NarrativeBeat[];
  mapLabels: MapLabel[];
  timelineEvents: TimelineEvent[];
}

type MapMode = "battle" | "present-day";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatNumber(value: number | undefined): string {
  if (typeof value !== "number") {
    return "N/A";
  }

  return value.toLocaleString();
}

export default function BattlefieldExperience() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [mapMode, setMapMode] = useState<MapMode>("battle");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  const {
    data,
    selectedTime,
    isPlaying,
    speed,
    activeBeatId,
    cameraPoseOverride,
    guidedMode,
    hoveredEventId,
    setData,
    setTime,
    setSpeed,
    togglePlayback,
    setGuidedMode,
    selectBeat,
    clearCameraOverride,
    setHoveredEventId,
    advanceTimeline,
  } = useBattleStore();

  const animationFrameRef = useRef<number | null>(null);
  const previousFrameRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);

        const manifest = await fetchJson<BattleManifest>("/data/franklin/manifest.json");

        const [divisions, events, sources, terrainDem] = await Promise.all([
          fetchJson<DivisionsPayload>("/data/franklin/divisions.json"),
          fetchJson<EventsPayload>("/data/franklin/events.json"),
          fetchJson<SourceCitation[]>("/data/franklin/sources.json"),
          manifest.terrain.demGridPath
            ? fetchJson<TerrainDem>(manifest.terrain.demGridPath)
            : Promise.resolve(null),
        ]);

        const bundle: BattleDataBundle = {
          manifest,
          units: divisions.units,
          timeSlices: divisions.timeSlices,
          narrativeBeats: events.narrativeBeats,
          mapLabels: events.mapLabels,
          timelineEvents: events.timelineEvents,
          sources,
          terrainDem,
        };

        const validationResult = validateBattleData(bundle);
        if (!validationResult.valid) {
          setValidationErrors(validationResult.errors);
        }

        if (!cancelled) {
          setData(bundle);
          setSelectedUnitId(divisions.units[0]?.id ?? null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load battle data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [setData]);

  useEffect(() => {
    const frame = (time: number) => {
      if (previousFrameRef.current === 0) {
        previousFrameRef.current = time;
      }

      const delta = time - previousFrameRef.current;
      previousFrameRef.current = time;

      advanceTimeline(delta);
      animationFrameRef.current = requestAnimationFrame(frame);
    };

    animationFrameRef.current = requestAnimationFrame(frame);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      previousFrameRef.current = 0;
    };
  }, [advanceTimeline]);

  useEffect(() => {
    if (!data) {
      return;
    }

    if (!selectedUnitId && data.units.length > 0) {
      setSelectedUnitId(data.units[0].id);
      return;
    }

    if (selectedUnitId && !data.units.some((unit) => unit.id === selectedUnitId)) {
      setSelectedUnitId(data.units[0]?.id ?? null);
    }
  }, [data, selectedUnitId]);

  const activeEvent = useMemo(() => {
    if (!data) {
      return null;
    }

    if (hoveredEventId) {
      return data.timelineEvents.find((event) => event.id === hoveredEventId) ?? null;
    }

    return resolveActiveTimelineEvent(selectedTime, data.timelineEvents);
  }, [data, hoveredEventId, selectedTime]);

  const currentUnitStateById = useMemo(() => {
    if (!data) {
      return new Map<string, ReturnType<typeof interpolateUnitPositions>[number]>();
    }

    const positions = interpolateUnitPositions(selectedTime, data.timeSlices);
    return new Map(positions.map((position) => [position.unitId, position]));
  }, [data, selectedTime]);

  const selectedUnit = useMemo(() => {
    if (!data || !selectedUnitId) {
      return null;
    }

    return data.units.find((unit) => unit.id === selectedUnitId) ?? null;
  }, [data, selectedUnitId]);

  const selectedUnitState = selectedUnit
    ? currentUnitStateById.get(selectedUnit.id) ?? null
    : null;

  if (loading) {
    return <p className="status-card">Loading the Franklin battlefield simulation...</p>;
  }

  if (error || !data) {
    return (
      <p className="status-card error" role="alert">
        {error ?? "Battle data not available."}
      </p>
    );
  }

  const start = Date.parse(data.manifest.timeStart);
  const end = Date.parse(data.manifest.timeEnd);
  const confidenceStyle = activeEvent ? getConfidenceStyle(activeEvent.confidence) : null;

  return (
    <div className="battlefield-layout" data-testid="battlefield-app">
      <header className="battle-header">
        <div>
          <p className="eyebrow">Civil War Immersive Vertical Slice</p>
          <h1>{data.manifest.name}</h1>
          <p className="subtitle">
            November 30, 1864, Franklin, Tennessee. Division-level playback with documented vs inferred
            provenance visibility.
          </p>
          <div className="view-toggle" role="tablist" aria-label="Battlefield view mode">
            <button
              type="button"
              className={mapMode === "battle" ? "active" : ""}
              onClick={() => setMapMode("battle")}
              data-testid="view-battle-button"
            >
              Battlefield 3D
            </button>
            <button
              type="button"
              className={mapMode === "present-day" ? "active" : ""}
              onClick={() => setMapMode("present-day")}
              data-testid="view-present-button"
            >
              Present-Day Mapbox
            </button>
          </div>
        </div>
        <div className="status-block">
          <span className="status-label">Playback</span>
          <strong>{guidedMode ? "Guided Narrative" : "Free Exploration"}</strong>
          <span className="status-label">View</span>
          <strong>{mapMode === "battle" ? "Historical 3D" : "Present-Day"}</strong>
          <span className="status-label">Time</span>
          <strong>{formatClock(selectedTime)}</strong>
        </div>
      </header>

      <div className="battlefield-grid">
        <div className="scene-wrap">
          {mapMode === "battle" ? (
            <Scene
              manifest={data.manifest}
              units={data.units}
              timeSlices={data.timeSlices}
              mapLabels={data.mapLabels}
              terrainDem={data.terrainDem}
              selectedTime={selectedTime}
              activeBeatId={activeBeatId}
              selectedUnitId={selectedUnitId}
              cameraPoseOverride={cameraPoseOverride}
              focusUnitIds={
                data.narrativeBeats.find((beat) => beat.id === activeBeatId)?.focusUnitIds ?? []
              }
              onCameraOverrideConsumed={clearCameraOverride}
              onSelectUnit={setSelectedUnitId}
            />
          ) : (
            <PresentDayMapbox
              manifest={data.manifest}
              units={data.units}
              mapLabels={data.mapLabels}
              timeSlices={data.timeSlices}
              selectedTime={selectedTime}
              selectedUnitId={selectedUnitId}
              onSelectUnit={setSelectedUnitId}
            />
          )}

          {activeEvent ? (
            <aside
              className={`event-callout ${activeEvent.confidence === "inferred" ? "inferred" : "documented"}`}
              style={{ opacity: confidenceStyle?.opacity }}
            >
              <p>{formatClock(Date.parse(activeEvent.time))}</p>
              <h2>{activeEvent.title}</h2>
              <p>{activeEvent.detail}</p>
            </aside>
          ) : null}
        </div>

        <div className="panel-stack">
          <TimelineControls
            selectedTime={selectedTime}
            startTime={start}
            endTime={end}
            isPlaying={isPlaying}
            speed={speed}
            timelineEvents={data.timelineEvents}
            onTogglePlay={togglePlayback}
            onSpeedChange={(value) => setSpeed(value as PlaybackSpeed)}
            onTimeChange={setTime}
            onEventHover={setHoveredEventId}
          />

          <NarrativeMode
            guidedMode={guidedMode}
            activeBeatId={activeBeatId}
            beats={data.narrativeBeats}
            onToggleGuidedMode={setGuidedMode}
            onSelectBeat={selectBeat}
          />

          <section className="unit-card" aria-label="Selected unit details">
            <h2>Division Intel</h2>
            {selectedUnit ? (
              <div className="unit-card-grid">
                <div className="unit-card-title-row">
                  <span className={`side-pill ${selectedUnit.side.toLowerCase()}`}>
                    {selectedUnit.side}
                  </span>
                  <strong>{selectedUnit.name}</strong>
                </div>
                <div className="unit-stat-row">
                  <span>Commander</span>
                  <strong>{selectedUnit.commander}</strong>
                </div>
                <div className="unit-stat-row">
                  <span>Corps / Army</span>
                  <strong>
                    {selectedUnit.corps ?? "Unknown corps"} / {selectedUnit.army ?? "Unknown army"}
                  </strong>
                </div>
                <div className="unit-stat-row">
                  <span>Estimated Strength</span>
                  <strong>{formatNumber(selectedUnit.strengthEstimate)} personnel</strong>
                </div>
                <div className="unit-stat-row">
                  <span>Estimated Casualties</span>
                  <strong>{formatNumber(selectedUnit.casualtyEstimate)}</strong>
                </div>
                <div className="unit-stat-row">
                  <span>Current Formation</span>
                  <strong>{selectedUnitState?.formation ?? "Unknown"}</strong>
                </div>
                <div className="unit-stat-row">
                  <span>Engagement Status</span>
                  <strong>{selectedUnitState?.engaged ? "Engaged" : "Not engaged"}</strong>
                </div>
                <div className="unit-stat-row">
                  <span>Current Position</span>
                  <strong>
                    {selectedUnitState
                      ? `${selectedUnitState.lat.toFixed(4)}, ${selectedUnitState.lng.toFixed(4)}`
                      : "No position"}
                  </strong>
                </div>
                <div className="unit-stat-row">
                  <span>Confidence</span>
                  <strong>
                    {selectedUnitState?.confidence === "inferred"
                      ? "Inferred movement segment"
                      : "Documented movement segment"}
                  </strong>
                </div>
                {selectedUnit.notes ? <p className="unit-notes">{selectedUnit.notes}</p> : null}
              </div>
            ) : (
              <p className="unit-empty">Select a division marker in 3D or Mapbox mode.</p>
            )}
          </section>

          <section className="legend-card" aria-label="Legend and data confidence">
            <h2>Legend</h2>
            <div className="legend-row">
              <span className="swatch union" />
              <span>Union divisions</span>
            </div>
            <div className="legend-row">
              <span className="swatch confederate" />
              <span>Confederate divisions</span>
            </div>
            <div className="legend-row">
              <span className="swatch documented" />
              <span>Documented movement segment</span>
            </div>
            <div className="legend-row">
              <span className="swatch inferred" />
              <span>Inferred segment (ghosted + dashed)</span>
            </div>
          </section>

          <section className="sources-card" aria-label="Sources">
            <h2>Source citations</h2>
            <ul>
              {data.sources.map((source) => (
                <li key={source.id}>
                  <strong>{source.title}</strong>
                  <span>
                    {source.author} ({source.year})
                  </span>
                  <small>{source.note}</small>
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noreferrer">
                      Open source
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          {validationErrors.length > 0 ? (
            <section className="validation-card" aria-label="Data validation warnings">
              <h2>Validation warnings</h2>
              <ul>
                {validationErrors.map((validationError) => (
                  <li key={validationError}>{validationError}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
