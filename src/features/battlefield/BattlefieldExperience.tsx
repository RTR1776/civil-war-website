"use client";

import { useEffect, useMemo, useState } from "react";

import CanvasBattlefield from "@/features/battlefield/CanvasBattlefield";
import ControlDock from "@/features/battlefield/ControlDock";
import EpilogueOverlay from "@/features/battlefield/EpilogueOverlay";
import IntelCard from "@/features/battlefield/IntelCard";
import IntroOverlay from "@/features/battlefield/IntroOverlay";
import PresentDayMapbox from "@/features/battlefield/PresentDayMapbox";
import RecordsPanel from "@/features/battlefield/RecordsPanel";
import StoryRail from "@/features/battlefield/StoryRail";
import { useBattleStore } from "@/lib/battle/store";
import { loadScenarioData } from "@/lib/battle/scenarioLoader";
import { formatBattleClock } from "@/lib/battle/time";
import { validateScenarioData } from "@/lib/battle/validation";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();

function BeatCaption() {
  const data = useBattleStore((state) => state.data);
  const activeBeatId = useBattleStore((state) => state.storyState.activeBeatId);
  const guidedMode = useBattleStore((state) => state.uiState.guidedMode);

  const beat = useMemo(
    () => data?.narrativeBeats.find((entry) => entry.id === activeBeatId) ?? null,
    [activeBeatId, data],
  );

  if (!beat || !guidedMode) {
    return null;
  }

  return (
    <div className="beat-caption" data-testid="beat-caption" key={beat.id}>
      <p className="caption-time">
        {formatBattleClock(Date.parse(beat.time))}
        {beat.confidence === "inferred" ? <span className="confidence-chip inferred">Inferred</span> : null}
      </p>
      <h2>{beat.title}</h2>
      <p className="caption-body">{beat.description}</p>
    </div>
  );
}

function HoveredEventToast() {
  const data = useBattleStore((state) => state.data);
  const hoveredEventId = useBattleStore((state) => state.uiState.hoveredEventId);

  const event = useMemo(
    () => data?.timelineEvents.find((entry) => entry.id === hoveredEventId) ?? null,
    [data, hoveredEventId],
  );

  if (!event) {
    return null;
  }

  return (
    <div className="event-toast" role="status">
      <span>{formatBattleClock(Date.parse(event.time))}</span>
      <strong>{event.title}</strong>
      <small>{event.detail}</small>
    </div>
  );
}

export default function BattlefieldExperience() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [showEpilogue, setShowEpilogue] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [railOpen, setRailOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 900,
  );
  const [satelliteView, setSatelliteView] = useState(false);

  const data = useBattleStore((state) => state.data);
  const sidebarMode = useBattleStore((state) => state.uiState.sidebarMode);
  const guidedMode = useBattleStore((state) => state.uiState.guidedMode);
  const storyComplete = useBattleStore((state) => state.storyState.storyComplete);
  const selectedFormationId = useBattleStore((state) => state.uiState.selectedFormationId);
  const setData = useBattleStore((state) => state.setData);
  const setSidebarMode = useBattleStore((state) => state.setSidebarMode);
  const beginStory = useBattleStore((state) => state.beginStory);
  const acknowledgeStoryComplete = useBattleStore((state) => state.acknowledgeStoryComplete);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(query.matches);
    setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
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

  // Guided playback reaching the end of the timeline raises the epilogue.
  useEffect(() => {
    if (storyComplete) {
      setShowEpilogue(true);
      acknowledgeStoryComplete();
    }
  }, [acknowledgeStoryComplete, storyComplete]);

  // Global keyboard control.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (showIntro || event.target instanceof HTMLInputElement) {
        return;
      }

      const store = useBattleStore.getState();

      if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        store.togglePlayback();
      } else if (event.key === "ArrowLeft") {
        store.seek(store.simulationState.simTimeMs - 15 * 60 * 1000);
      } else if (event.key === "ArrowRight") {
        store.seek(store.simulationState.simTimeMs + 15 * 60 * 1000);
      } else if (event.key === "Escape") {
        if (showEpilogue) {
          setShowEpilogue(false);
        } else if (showRecords) {
          setShowRecords(false);
        } else if (store.uiState.selectedFormationId) {
          store.selectFormation(null);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showEpilogue, showIntro, showRecords]);

  if (loading) {
    return (
      <div className="status-veil" data-testid="loading-veil">
        <p className="status-line">Raising the colors&hellip;</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="status-veil">
        <p className="status-line error" role="alert">
          {error ?? "Battle data not available."}
        </p>
      </div>
    );
  }

  const handleBeginStory = () => {
    setShowIntro(false);
    setShowEpilogue(false);
    setSatelliteView(false);
    beginStory();
  };

  const handleExplore = () => {
    setShowIntro(false);
    setShowEpilogue(false);
    setSidebarMode("analyze");
  };

  const storyActive = sidebarMode === "story" && guidedMode;

  return (
    <div className="stage-root" data-testid="battlefield-app" data-mode={sidebarMode}>
      {satelliteView && MAPBOX_TOKEN ? (
        <SatelliteStage />
      ) : (
        <CanvasBattlefield bundle={data} attract={showIntro} reducedMotion={reducedMotion} />
      )}

      {!showIntro ? (
        <>
          <header className="hud-top">
            <div className="hud-title">
              <p className="eyebrow">November 30, 1864</p>
              <h1>{data.manifest.name}</h1>
            </div>

            <div className="hud-modes" role="group" aria-label="View mode">
              <button
                type="button"
                className={storyActive ? "active" : ""}
                data-testid="mode-story"
                onClick={() => {
                  setSatelliteView(false);
                  if (!storyActive) {
                    beginStory();
                  }
                }}
              >
                Story
              </button>
              <button
                type="button"
                className={sidebarMode === "analyze" && !satelliteView ? "active" : ""}
                data-testid="mode-explore"
                onClick={() => {
                  setSatelliteView(false);
                  setSidebarMode("analyze");
                }}
              >
                Explore
              </button>
              {MAPBOX_TOKEN ? (
                <button
                  type="button"
                  className={satelliteView ? "active" : ""}
                  data-testid="mode-satellite"
                  onClick={() => {
                    setSatelliteView(true);
                    setSidebarMode("analyze");
                  }}
                >
                  Satellite
                </button>
              ) : null}
              <button
                type="button"
                className={showRecords ? "active" : ""}
                data-testid="mode-records"
                onClick={() => setShowRecords((open) => !open)}
              >
                Records
              </button>
            </div>
          </header>

          <button
            type="button"
            className={`rail-toggle ${railOpen ? "open" : ""}`}
            aria-expanded={railOpen}
            aria-controls="story-rail"
            onClick={() => setRailOpen((open) => !open)}
          >
            {railOpen ? "‹" : "›"} <span>Chapters</span>
          </button>

          <div id="story-rail" className={`rail-wrap ${railOpen ? "open" : ""}`}>
            <StoryRail bundle={data} onOpenEpilogue={() => setShowEpilogue(true)} />
          </div>

          {!satelliteView ? <BeatCaption /> : null}
          <HoveredEventToast />
          <ControlDock bundle={data} />
          {selectedFormationId ? <IntelCard bundle={data} /> : null}
          {showRecords ? (
            <RecordsPanel
              bundle={data}
              validationErrors={validationErrors}
              onClose={() => setShowRecords(false)}
            />
          ) : null}
        </>
      ) : null}

      {showIntro ? (
        <IntroOverlay
          onBeginStory={handleBeginStory}
          onExplore={handleExplore}
          reducedMotion={reducedMotion}
        />
      ) : null}

      {showEpilogue ? (
        <EpilogueOverlay
          bundle={data}
          onReplay={handleBeginStory}
          onExplore={() => {
            setShowEpilogue(false);
            handleExplore();
          }}
          onClose={() => setShowEpilogue(false)}
        />
      ) : null}
    </div>
  );
}

function SatelliteStage() {
  const data = useBattleStore((state) => state.data);
  const selectedFormationId = useBattleStore((state) => state.uiState.selectedFormationId);
  const selectFormation = useBattleStore((state) => state.selectFormation);
  const activeBeatId = useBattleStore((state) => state.storyState.activeBeatId);
  const displayTime = useBattleStore(
    (state) => Math.round(state.simulationState.simTimeMs / 1000) * 1000,
  );

  if (!data) {
    return null;
  }

  return (
    <div className="satellite-stage">
      <PresentDayMapbox
        manifest={data.manifest}
        formations={data.formations}
        movementKeyframes={data.movementKeyframes}
        mapLabels={data.mapLabels}
        narrativeBeats={data.narrativeBeats}
        chapters={data.chapters}
        mapLayerPack={data.mapLayerPack}
        selectedTime={displayTime}
        activeBeatId={activeBeatId}
        guidedMode={false}
        selectedFormationId={selectedFormationId}
        mapMode="modern"
        onSelectFormation={selectFormation}
      />
    </div>
  );
}
