"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import NarrativeMode from "@/features/battlefield/NarrativeMode";
import PresentDayMapbox, { type MapTheme } from "@/features/battlefield/PresentDayMapbox";
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
  CasualtyTick,
  DivisionUnit,
  MapLabel,
  NarrativeBeat,
  SourceCitation,
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
  casualtyTimeline: CasualtyTick[];
}

type PanelTab = "intel" | "sources";

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

function interpolateCasualtyState(
  selectedTime: number,
  timeline: CasualtyTick[],
): { value: number; confidence: "documented" | "inferred"; note?: string } {
  if (timeline.length === 0) {
    return { value: 0, confidence: "inferred" };
  }

  const ordered = [...timeline].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const start = ordered[0];
  const end = ordered[ordered.length - 1];

  const selected = Math.min(
    Date.parse(end.time),
    Math.max(Date.parse(start.time), selectedTime),
  );

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const left = ordered[index];
    const right = ordered[index + 1];
    const leftTime = Date.parse(left.time);
    const rightTime = Date.parse(right.time);

    if (selected >= leftTime && selected <= rightTime) {
      const ratio = (selected - leftTime) / Math.max(1, rightTime - leftTime);
      const value = Math.round(
        left.cumulativeCasualties + (right.cumulativeCasualties - left.cumulativeCasualties) * ratio,
      );

      return {
        value,
        confidence:
          left.confidence === "documented" && right.confidence === "documented"
            ? "documented"
            : "inferred",
        note: right.note ?? left.note,
      };
    }
  }

  return {
    value: end.cumulativeCasualties,
    confidence: end.confidence,
    note: end.note,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export default function BattlefieldExperience() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [mapTheme, setMapTheme] = useState<MapTheme>("historical");
  const [panelTab, setPanelTab] = useState<PanelTab>("intel");

  const {
    data,
    selectedTime,
    isPlaying,
    speed,
    activeBeatId,
    guidedMode,
    hoveredEventId,
    setData,
    setTime,
    setSpeed,
    togglePlayback,
    setGuidedMode,
    selectBeat,
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

        const [divisions, events, sources] = await Promise.all([
          fetchJson<DivisionsPayload>("/data/franklin/divisions.json"),
          fetchJson<EventsPayload>("/data/franklin/events.json"),
          fetchJson<SourceCitation[]>("/data/franklin/sources.json"),
        ]);

        const bundle: BattleDataBundle = {
          manifest,
          units: divisions.units,
          timeSlices: divisions.timeSlices,
          narrativeBeats: events.narrativeBeats,
          mapLabels: events.mapLabels,
          timelineEvents: events.timelineEvents,
          casualtyTimeline: events.casualtyTimeline,
          sources,
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

  const casualtyState = useMemo(
    () => (data ? interpolateCasualtyState(selectedTime, data.casualtyTimeline) : null),
    [data, selectedTime],
  );

  const totalCasualtyEstimate = useMemo(() => {
    if (!data) {
      return 0;
    }

    const fromTimeline = data.casualtyTimeline[data.casualtyTimeline.length - 1]?.cumulativeCasualties ?? 0;
    const fromUnits = data.units.reduce((sum, unit) => sum + (unit.casualtyEstimate ?? 0), 0);
    return Math.max(fromTimeline, fromUnits);
  }, [data]);

  const sideCasualtyEstimates = useMemo(() => {
    if (!data || !casualtyState) {
      return { union: 0, confederate: 0 };
    }

    const unionTotal = data.units
      .filter((unit) => unit.side === "Union")
      .reduce((sum, unit) => sum + (unit.casualtyEstimate ?? 0), 0);

    const confederateTotal = data.units
      .filter((unit) => unit.side === "Confederate")
      .reduce((sum, unit) => sum + (unit.casualtyEstimate ?? 0), 0);

    const ratio = totalCasualtyEstimate > 0 ? casualtyState.value / totalCasualtyEstimate : 0;

    return {
      union: Math.round(unionTotal * ratio),
      confederate: Math.round(confederateTotal * ratio),
    };
  }, [casualtyState, data, totalCasualtyEstimate]);

  const casualtyBreakdown = useMemo(() => {
    if (!casualtyState) {
      return { killed: 0, wounded: 0, missing: 0 };
    }

    const killed = Math.round(casualtyState.value * 0.2);
    const wounded = Math.round(casualtyState.value * 0.7);
    const missing = Math.max(0, casualtyState.value - killed - wounded);

    return { killed, wounded, missing };
  }, [casualtyState]);

  if (loading) {
    return <p className="status-card">Loading the Franklin battle timelapse...</p>;
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
          <p className="eyebrow">Civil War Timelapse Map Experience</p>
          <h1>{data.manifest.name}</h1>
          <p className="subtitle">
            Historic-styled Mapbox playback of troop movement, key battlefield landmarks, and casualty
            progression across November 30, 1864.
          </p>
          <div className="theme-toggle" role="tablist" aria-label="Map theme">
            <button
              type="button"
              className={mapTheme === "historical" ? "active" : ""}
              onClick={() => setMapTheme("historical")}
            >
              1864 Field Style
            </button>
            <button
              type="button"
              className={mapTheme === "modern" ? "active" : ""}
              onClick={() => setMapTheme("modern")}
            >
              Modern Context
            </button>
          </div>
          <p className="subtitle">
            Historical mode suppresses modern roads, POIs, and place labels to keep focus on 1864
            battle geometry. Use <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + scroll to zoom.
          </p>
        </div>
        <div className="status-block">
          <span className="status-label">Mode</span>
          <strong>Mapbox Historical Timelapse</strong>
          <span className="status-label">Basemap</span>
          <strong>{mapTheme === "historical" ? "1864 Field Style" : "Modern Context"}</strong>
          <span className="status-label">Playback</span>
          <strong>{guidedMode ? "Guided Narrative" : "Free Exploration"}</strong>
          <span className="status-label">Time</span>
          <strong>{formatClock(selectedTime)}</strong>
        </div>
      </header>

      <div className="battlefield-grid">
        <div className="scene-wrap">
          <PresentDayMapbox
            manifest={data.manifest}
            units={data.units}
            mapLabels={data.mapLabels}
            narrativeBeats={data.narrativeBeats}
            timeSlices={data.timeSlices}
            selectedTime={selectedTime}
            activeBeatId={activeBeatId}
            guidedMode={guidedMode}
            selectedUnitId={selectedUnitId}
            mapTheme={mapTheme}
            onSelectUnit={setSelectedUnitId}
          />

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

          <div className="panel-tabs" role="tablist" aria-label="Sidebar sections">
            <button
              type="button"
              className={panelTab === "intel" ? "active" : ""}
              onClick={() => setPanelTab("intel")}
            >
              Battle Intel
            </button>
            <button
              type="button"
              className={panelTab === "sources" ? "active" : ""}
              onClick={() => setPanelTab("sources")}
            >
              Sources
            </button>
          </div>

          {panelTab === "intel" ? (
            <>
              <section className="casualty-card" aria-label="Estimated casualties">
                <h2>Casualty Counter</h2>
                <p className="casualty-total">{formatNumber(casualtyState?.value)} total casualties</p>
                <div className="casualty-sides">
                  <div>
                    <span>Union (est.)</span>
                    <strong>{formatNumber(sideCasualtyEstimates.union)}</strong>
                  </div>
                  <div>
                    <span>Confederate (est.)</span>
                    <strong>{formatNumber(sideCasualtyEstimates.confederate)}</strong>
                  </div>
                </div>
                <div className="casualty-breakdown">
                  <div>
                    <span>Killed (est.)</span>
                    <strong>{formatNumber(casualtyBreakdown.killed)}</strong>
                  </div>
                  <div>
                    <span>Wounded (est.)</span>
                    <strong>{formatNumber(casualtyBreakdown.wounded)}</strong>
                  </div>
                  <div>
                    <span>Missing/Captured (est.)</span>
                    <strong>{formatNumber(casualtyBreakdown.missing)}</strong>
                  </div>
                </div>
                <p className="casualty-note">
                  {casualtyState?.confidence === "inferred"
                    ? "Includes inferred interval interpolation between documented casualty checkpoints."
                    : "Derived from documented checkpoint totals."}
                </p>
                {casualtyState?.note ? <small>{casualtyState.note}</small> : null}
              </section>

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
                  <p className="unit-empty">Select a formation on the map to inspect details.</p>
                )}
              </section>

              <section className="legend-card" aria-label="Legend and data confidence">
                <h2>Legend</h2>
                <div className="legend-row">
                  <span className="swatch union" />
                  <span>Union formations</span>
                </div>
                <div className="legend-row">
                  <span className="swatch confederate" />
                  <span>Confederate formations</span>
                </div>
                <div className="legend-row">
                  <span className="swatch documented" />
                  <span>Documented movement segment</span>
                </div>
                <div className="legend-row">
                  <span className="swatch inferred" />
                  <span>Inferred segment (ghosted)</span>
                </div>
              </section>
            </>
          ) : (
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
          )}

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
