"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import PresentDayMapbox from "@/features/battlefield/PresentDayMapbox";
import TimelineControls from "@/features/battlefield/TimelineControls";
import { getConfidenceStyle, interpolateFormationPositions } from "@/lib/battle/interpolation";
import { loadScenarioData } from "@/lib/battle/scenarioLoader";
import { resolveActiveTimelineEvent, useBattleStore, type PlaybackSpeed } from "@/lib/battle/store";
import type { CasualtyTick, ChapterScene, NarrativeBeat, ScenarioDataBundle } from "@/lib/battle/types";
import { validateScenarioData } from "@/lib/battle/validation";

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

  const selected = Math.min(Date.parse(end.time), Math.max(Date.parse(start.time), selectedTime));

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

function chapterOverlayText(chapter: ChapterScene | null, selectedTime: number): string | null {
  if (!chapter || chapter.cameraRail.length === 0) {
    return null;
  }

  if (chapter.cameraRail.length === 1) {
    return chapter.cameraRail[0].overlayText ?? chapter.summary;
  }

  const chapterStart = Date.parse(chapter.startTime);
  const offset = Math.max(0, selectedTime - chapterStart);

  let candidate = chapter.cameraRail[0];

  for (const keyframe of chapter.cameraRail) {
    if (keyframe.timeOffsetMs <= offset) {
      candidate = keyframe;
    }
  }

  return candidate.overlayText ?? chapter.summary;
}

function chapterForBeat(bundle: ScenarioDataBundle, beatId: string | null): ChapterScene | null {
  if (!beatId) {
    return null;
  }

  return bundle.chapters.find((chapter) => chapter.beatIds.includes(beatId)) ?? null;
}

function resolveBeat(bundle: ScenarioDataBundle, beatId: string | null): NarrativeBeat | null {
  if (!beatId) {
    return null;
  }

  return bundle.narrativeBeats.find((beat) => beat.id === beatId) ?? null;
}

function withStagger(index: number): CSSProperties {
  return {
    ["--stagger" as string]: `${index}`,
  };
}

export default function BattlefieldExperienceV2() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);

  const {
    data,
    simulationState,
    uiState,
    storyState,
    setData,
    setSpeed,
    togglePlayback,
    seek,
    setHoveredEventId,
    advanceTimeline,
    setGuidedMode,
    setSidebarMode,
    toggleMapMode,
    selectFormation,
    selectBeat,
    selectChapter,
    replayChapter,
    skipToPivotal,
    lockCameraToFormation,
  } = useBattleStore();

  const animationFrameRef = useRef<number | null>(null);
  const previousFrameRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(query.matches);

    setReducedMotion(query.matches);
    query.addEventListener("change", onChange);

    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);

        const bundle = await loadScenarioData("/data/franklin");
        const validation = validateScenarioData(bundle);

        if (!cancelled) {
          setValidationErrors(validation.errors);
          setData(bundle);
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
    if (!simulationState.isPlaying || uiState.guidedMode) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      previousFrameRef.current = 0;
      return;
    }

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
      animationFrameRef.current = null;
      previousFrameRef.current = 0;
    };
  }, [advanceTimeline, simulationState.isPlaying, uiState.guidedMode]);

  const selectedTime = simulationState.simTimeMs;

  const activeEvent = useMemo(() => {
    if (!data) {
      return null;
    }

    if (uiState.hoveredEventId) {
      return data.timelineEvents.find((event) => event.id === uiState.hoveredEventId) ?? null;
    }

    return resolveActiveTimelineEvent(selectedTime, data.timelineEvents);
  }, [data, selectedTime, uiState.hoveredEventId]);

  const positionsByFormationId = useMemo(() => {
    if (!data) {
      return new Map<string, ReturnType<typeof interpolateFormationPositions>[number]>();
    }

    const positions = interpolateFormationPositions(selectedTime, data.movementKeyframes);
    return new Map(positions.map((position) => [position.formationId, position]));
  }, [data, selectedTime]);

  const selectedFormation = useMemo(() => {
    if (!data || !uiState.selectedFormationId) {
      return null;
    }

    return data.formations.find((formation) => formation.id === uiState.selectedFormationId) ?? null;
  }, [data, uiState.selectedFormationId]);

  const selectedFormationState = selectedFormation
    ? positionsByFormationId.get(selectedFormation.id) ?? null
    : null;

  const activeBeat = useMemo(() => {
    if (!data) {
      return null;
    }

    return resolveBeat(data, storyState.activeBeatId);
  }, [data, storyState.activeBeatId]);

  const activeChapter = useMemo(() => {
    if (!data) {
      return null;
    }

    if (storyState.activeChapterId) {
      return data.chapters.find((chapter) => chapter.id === storyState.activeChapterId) ?? null;
    }

    return chapterForBeat(data, storyState.activeBeatId);
  }, [data, storyState.activeBeatId, storyState.activeChapterId]);

  const overlayText = useMemo(
    () => chapterOverlayText(activeChapter, selectedTime) ?? activeBeat?.title ?? null,
    [activeBeat?.title, activeChapter, selectedTime],
  );

  const casualtyState = useMemo(
    () => (data ? interpolateCasualtyState(selectedTime, data.casualtyTimeline) : null),
    [data, selectedTime],
  );

  const totalCasualtyEstimate = useMemo(() => {
    if (!data) {
      return 0;
    }

    const fromTimeline = data.casualtyTimeline[data.casualtyTimeline.length - 1]?.cumulativeCasualties ?? 0;
    const fromUnits = data.formations.reduce((sum, formation) => sum + (formation.casualtyEstimate ?? 0), 0);
    return Math.max(fromTimeline, fromUnits);
  }, [data]);

  const sideCasualtyEstimates = useMemo(() => {
    if (!data || !casualtyState) {
      return { union: 0, confederate: 0 };
    }

    const unionTotal = data.formations
      .filter((formation) => formation.side === "Union")
      .reduce((sum, formation) => sum + (formation.casualtyEstimate ?? 0), 0);

    const confederateTotal = data.formations
      .filter((formation) => formation.side === "Confederate")
      .reduce((sum, formation) => sum + (formation.casualtyEstimate ?? 0), 0);

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
    return <p className="status-card">Loading the Franklin immersive story engine...</p>;
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
  const timelineProgress = Math.round(
    ((selectedTime - start) / Math.max(1, end - start)) * 100,
  );
  const chapterProgress = activeChapter
    ? Math.round(
        ((selectedTime - Date.parse(activeChapter.startTime))
          / Math.max(1, Date.parse(activeChapter.endTime) - Date.parse(activeChapter.startTime)))
          * 100,
      )
    : 0;
  const activeChapterEvidenceCount = activeChapter
    ? data.evidenceClaims.filter((claim) => claim.linkedChapterIds?.includes(activeChapter.id)).length
    : data.evidenceClaims.length;

  const chapterToRender = activeChapter;
  const selectedLockId = storyState.lockedFormationId;

  return (
    <div className="battlefield-layout v2" data-testid="battlefield-app-v2">
      <header className="battle-header">
        <div>
          <p className="eyebrow">Civil War Story Engine</p>
          <h1>{data.manifest.name}</h1>
          <p className="subtitle">
            Cinematic reconstruction mode with source-linked evidence, chapter-driven camera rails, and
            analyst controls.
          </p>
          <div className="theme-toggle" role="tablist" aria-label="Map mode">
            <button
              type="button"
              className={uiState.mapMode === "reconstructed" ? "active" : ""}
              onClick={() => toggleMapMode("reconstructed")}
            >
              Reconstructed 1864
            </button>
            <button
              type="button"
              className={uiState.mapMode === "modern" ? "active" : ""}
              onClick={() => toggleMapMode("modern")}
            >
              Modern Comparison
            </button>
          </div>
          <div className="battle-meta-row" aria-label="Story context summary">
            <span className="meta-pill">
              Chapter: {activeChapter?.title ?? "Operational Overview"}
            </span>
            <span className="meta-pill">
              Timeline: {Math.max(0, Math.min(100, timelineProgress))}%
            </span>
            <span className="meta-pill">
              Linked claims: {activeChapterEvidenceCount}
            </span>
          </div>
        </div>
        <div className="status-block">
          <span className="status-label">Sidebar</span>
          <strong>{uiState.sidebarMode}</strong>
          <span className="status-label">Map Mode</span>
          <strong>{uiState.mapMode === "reconstructed" ? "Reconstructed 1864" : "Modern Comparison"}</strong>
          <span className="status-label">Playback</span>
          <strong>{uiState.guidedMode ? "Guided Story" : "Free Analysis"}</strong>
          <span className="status-label">Motion</span>
          <strong>{reducedMotion ? "Reduced" : "Cinematic"}</strong>
          <span className="status-label">Time</span>
          <strong>{formatClock(selectedTime)}</strong>
        </div>
      </header>

      <div className="battlefield-grid">
        <div className="scene-wrap">
          <PresentDayMapbox
            manifest={data.manifest}
            formations={data.formations}
            movementKeyframes={data.movementKeyframes}
            mapLabels={data.mapLabels}
            narrativeBeats={data.narrativeBeats}
            chapters={data.chapters}
            mapLayerPack={data.mapLayerPack}
            selectedTime={selectedTime}
            activeBeatId={storyState.activeBeatId}
            activeChapterId={storyState.activeChapterId}
            guidedMode={uiState.guidedMode}
            selectedFormationId={uiState.selectedFormationId}
            lockedFormationId={storyState.lockedFormationId}
            mapMode={uiState.mapMode}
            reducedMotion={reducedMotion}
            onSelectFormation={selectFormation}
          />

          {activeEvent ? (
            <aside
              className={`event-callout ${activeEvent.confidence === "inferred" ? "inferred" : "documented"}`}
              style={{ opacity: confidenceStyle?.opacity }}
            >
              <p>{formatClock(Date.parse(activeEvent.time))}</p>
              <h2>{activeEvent.title}</h2>
              <p>{activeEvent.detail}</p>
              {overlayText ? <small>{overlayText}</small> : null}
              {activeChapter ? (
                <div className="chapter-progress">
                  <span>
                    {activeChapter.title} • {Math.max(0, Math.min(100, chapterProgress))}%
                  </span>
                  <div className="chapter-progress-track" aria-hidden="true">
                    <div
                      className="chapter-progress-fill"
                      style={{ width: `${Math.max(0, Math.min(100, chapterProgress))}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>

        <div className="panel-stack bottom-sheet" data-mode={uiState.sidebarMode}>
          <div className="panel-tabs top-level" role="tablist" aria-label="Experience modes">
            <button
              type="button"
              className={uiState.sidebarMode === "story" ? "active" : ""}
              onClick={() => setSidebarMode("story")}
            >
              Story
            </button>
            <button
              type="button"
              className={uiState.sidebarMode === "analyze" ? "active" : ""}
              onClick={() => setSidebarMode("analyze")}
            >
              Analyze
            </button>
            <button
              type="button"
              className={uiState.sidebarMode === "evidence" ? "active" : ""}
              onClick={() => setSidebarMode("evidence")}
            >
              Evidence
            </button>
          </div>

          {uiState.sidebarMode === "story" ? (
            <div className="mode-panel mode-story" data-testid="mode-panel-story">
              <section className="narrative-card" aria-label="Chapter director">
                <div className="narrative-header">
                  <h2>Chapter Director</h2>
                  <button
                    type="button"
                    data-testid="guided-mode-toggle"
                    onClick={() => setGuidedMode(!uiState.guidedMode)}
                  >
                    {uiState.guidedMode ? "Exit Guided" : "Enter Guided"}
                  </button>
                </div>

                <div className="director-controls" aria-label="Director controls">
                  <button type="button" onClick={replayChapter}>
                    Replay Chapter
                  </button>
                  <button type="button" onClick={skipToPivotal} disabled={!chapterToRender?.pivotalEventId}>
                    Skip to Pivotal
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedLockId) {
                        lockCameraToFormation(null);
                        return;
                      }

                      const candidate = uiState.selectedFormationId
                        ?? chapterToRender?.cameraRail[0]?.focusFormationIds?.[0]
                        ?? null;

                      lockCameraToFormation(candidate);
                    }}
                    disabled={!selectedLockId && !uiState.selectedFormationId && !chapterToRender?.cameraRail[0]?.focusFormationIds?.[0]}
                  >
                    {selectedLockId ? "Unlock Camera" : "Lock to Formation"}
                  </button>
                </div>

                <div className="narrative-list" role="list">
                  {data.chapters.map((chapter, index) => (
                    <button
                      key={chapter.id}
                      type="button"
                      className={`narrative-item ${storyState.activeChapterId === chapter.id ? "active" : ""}`}
                      onClick={() => selectChapter(chapter.id)}
                      style={withStagger(index)}
                      data-testid={`chapter-${chapter.id}`}
                    >
                      <span>
                        {formatClock(Date.parse(chapter.startTime))} - {formatClock(Date.parse(chapter.endTime))}
                      </span>
                      <strong>{chapter.title}</strong>
                      <small>{chapter.summary}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="timeline-card" aria-label="Narrative beats">
                <div className="timeline-header">
                  <h2>Beat Timeline</h2>
                </div>
                <div className="narrative-list" role="list">
                  {data.narrativeBeats.map((beat, index) => (
                    <button
                      key={beat.id}
                      type="button"
                      className={`narrative-item ${storyState.activeBeatId === beat.id ? "active" : ""}`}
                      onClick={() => selectBeat(beat)}
                      style={withStagger(index)}
                      data-testid={`narrative-beat-${beat.id}`}
                    >
                      <span>{formatClock(Date.parse(beat.time))}</span>
                      <strong>{beat.title}</strong>
                      <small>{beat.description}</small>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {uiState.sidebarMode === "analyze" ? (
            <div className="mode-panel mode-analyze" data-testid="mode-panel-analyze">
              <TimelineControls
                selectedTime={selectedTime}
                startTime={start}
                endTime={end}
                isPlaying={simulationState.isPlaying}
                speed={simulationState.speed}
                timelineEvents={data.timelineEvents}
                onTogglePlay={togglePlayback}
                onSpeedChange={(value) => setSpeed(value as PlaybackSpeed)}
                onTimeChange={seek}
                onEventHover={setHoveredEventId}
              />

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
                    ? "Includes inferred interpolation between documented casualty checkpoints."
                    : "Derived from documented checkpoint totals."}
                </p>
                {casualtyState?.note ? <small>{casualtyState.note}</small> : null}
              </section>

              <section className="unit-card" aria-label="Selected formation details">
                <h2>Formation Intel</h2>
                {selectedFormation ? (
                  <div className="unit-card-grid">
                    <div className="unit-card-title-row">
                      <span className={`side-pill ${selectedFormation.side.toLowerCase()}`}>
                        {selectedFormation.side}
                      </span>
                      <strong>{selectedFormation.name}</strong>
                    </div>
                    <div className="unit-stat-row">
                      <span>Commander</span>
                      <strong>{selectedFormation.commander}</strong>
                    </div>
                    <div className="unit-stat-row">
                      <span>Corps / Army</span>
                      <strong>
                        {selectedFormation.corps ?? "Unknown corps"} / {selectedFormation.army ?? "Unknown army"}
                      </strong>
                    </div>
                    <div className="unit-stat-row">
                      <span>Estimated Strength</span>
                      <strong>{formatNumber(selectedFormation.strengthEstimate)} personnel</strong>
                    </div>
                    <div className="unit-stat-row">
                      <span>Estimated Casualties</span>
                      <strong>{formatNumber(selectedFormation.casualtyEstimate)}</strong>
                    </div>
                    <div className="unit-stat-row">
                      <span>Current Formation</span>
                      <strong>{selectedFormationState?.formation ?? "Unknown"}</strong>
                    </div>
                    <div className="unit-stat-row">
                      <span>Engagement Status</span>
                      <strong>{selectedFormationState?.engaged ? "Engaged" : "Not engaged"}</strong>
                    </div>
                    <div className="unit-stat-row">
                      <span>Current Position</span>
                      <strong>
                        {selectedFormationState
                          ? `${selectedFormationState.lat.toFixed(4)}, ${selectedFormationState.lng.toFixed(4)}`
                          : "No position"}
                      </strong>
                    </div>
                    <div className="unit-stat-row">
                      <span>Confidence</span>
                      <strong>
                        {selectedFormationState?.confidence === "inferred"
                          ? "Inferred movement segment"
                          : "Documented movement segment"}
                      </strong>
                    </div>
                    {selectedFormation.notes ? <p className="unit-notes">{selectedFormation.notes}</p> : null}
                  </div>
                ) : (
                  <p className="unit-empty">Select a formation on the map to inspect details.</p>
                )}
              </section>
            </div>
          ) : null}

          {uiState.sidebarMode === "evidence" ? (
            <div className="mode-panel mode-evidence" data-testid="mode-panel-evidence">
              <section className="sources-card" aria-label="Evidence claims">
                <h2>Claims and Confidence</h2>
                <ul>
                  {data.evidenceClaims.map((claim, index) => (
                    <li key={claim.id} style={withStagger(index)}>
                      <strong>{claim.title}</strong>
                      <span>{claim.confidence === "documented" ? "Documented" : "Inferred"}</span>
                      <small>{claim.detail}</small>
                      <button
                        type="button"
                        onClick={() => {
                          const eventId = claim.linkedEventIds?.[0];
                          if (!eventId) {
                            return;
                          }

                          const event = data.timelineEvents.find((timelineEvent) => timelineEvent.id === eventId);
                          if (!event) {
                            return;
                          }

                          setHoveredEventId(event.id);
                          seek(Date.parse(event.time));
                        }}
                      >
                        Trace on Timeline
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="sources-card" aria-label="Sources">
                <h2>Source citations</h2>
                <ul>
                  {data.evidenceSources.map((source, index) => (
                    <li key={source.id} style={withStagger(index)}>
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
              ) : (
                <section className="validation-card" aria-label="Data validation warnings">
                  <h2>Validation status</h2>
                  <p className="unit-empty">No schema or evidence integrity warnings detected.</p>
                </section>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
