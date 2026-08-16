"use client";

import { useCallback, useMemo, useRef } from "react";

import { casualtiesAtTime } from "@/lib/battle/interpolation";
import { useBattleStore, type PlaybackSpeed } from "@/lib/battle/store";
import { DAY_PHASE_LABEL, dayPhase, formatBattleClock } from "@/lib/battle/time";
import type { ScenarioDataBundle } from "@/lib/battle/types";

interface ControlDockProps {
  bundle: ScenarioDataBundle;
}

function PhaseGlyph({ phase }: { phase: ReturnType<typeof dayPhase> }) {
  if (phase === "night") {
    return (
      <svg viewBox="0 0 20 20" className="phase-glyph" aria-hidden="true">
        <path
          d="M15.4 12.7A6.6 6.6 0 0 1 7.3 4.6a6.6 6.6 0 1 0 8.1 8.1Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (phase === "dusk" || phase === "golden") {
    return (
      <svg viewBox="0 0 20 20" className="phase-glyph" aria-hidden="true">
        <path d="M3 13.5h14M5.5 16h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M6 12a4 4 0 0 1 8 0" fill="currentColor" />
        <path d="M10 3.4v2M4.7 5.9l1.4 1.4M15.3 5.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" className="phase-glyph" aria-hidden="true">
      <circle cx="10" cy="10" r="4" fill="currentColor" />
      <path
        d="M10 2.2v2.2M10 15.6v2.2M2.2 10h2.2M15.6 10h2.2M4.5 4.5l1.5 1.5M14 14l1.5 1.5M15.5 4.5 14 6M6 14l-1.5 1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ControlDock({ bundle }: ControlDockProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const isPlaying = useBattleStore((state) => state.simulationState.isPlaying);
  const speed = useBattleStore((state) => state.simulationState.speed);
  // Rounded so the dock re-renders a few times a second, not per frame.
  const displayTime = useBattleStore(
    (state) => Math.round(state.simulationState.simTimeMs / 5000) * 5000,
  );
  const togglePlayback = useBattleStore((state) => state.togglePlayback);
  const setSpeed = useBattleStore((state) => state.setSpeed);
  const seek = useBattleStore((state) => state.seek);
  const setHoveredEventId = useBattleStore((state) => state.setHoveredEventId);

  const start = Date.parse(bundle.manifest.timeStart);
  const end = Date.parse(bundle.manifest.timeEnd);
  const span = Math.max(1, end - start);
  const progress = Math.min(1, Math.max(0, (displayTime - start) / span));

  const phase = dayPhase(displayTime);
  const casualtyState = useMemo(
    () => casualtiesAtTime(bundle.casualtyTimeline, displayTime),
    [bundle.casualtyTimeline, displayTime],
  );

  const sideTotals = useMemo(() => {
    const union = bundle.formations
      .filter((formation) => formation.side === "Union")
      .reduce((sum, formation) => sum + (formation.casualtyEstimate ?? 0), 0);
    const confederate = bundle.formations
      .filter((formation) => formation.side === "Confederate")
      .reduce((sum, formation) => sum + (formation.casualtyEstimate ?? 0), 0);
    return { union, confederate, total: Math.max(1, union + confederate) };
  }, [bundle.formations]);

  const orderedEvents = useMemo(
    () =>
      [...bundle.timelineEvents].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
    [bundle.timelineEvents],
  );

  const chapters = useMemo(
    () =>
      bundle.manifest.chapterOrder
        .map((chapterId) => bundle.chapters.find((chapter) => chapter.id === chapterId))
        .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter)),
    [bundle.chapters, bundle.manifest.chapterOrder],
  );

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) {
        return;
      }

      const rect = track.getBoundingClientRect();
      const ratioX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      seek(start + ratioX * span);
    },
    [seek, span, start],
  );

  return (
    <div className="control-dock" data-testid="control-dock">
      <div className="dock-clock" title={DAY_PHASE_LABEL[phase]}>
        <span className={`phase-badge phase-${phase}`}>
          <PhaseGlyph phase={phase} />
        </span>
        <div>
          <strong data-testid="dock-clock-time">{formatBattleClock(displayTime)}</strong>
          <small>{DAY_PHASE_LABEL[phase]}</small>
        </div>
      </div>

      <div className="dock-center">
        <div
          ref={trackRef}
          className="timeline-track"
          data-testid="timeline-track"
          role="slider"
          tabIndex={0}
          aria-label="Battle timeline"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={displayTime}
          aria-valuetext={formatBattleClock(displayTime)}
          onPointerDown={(event) => {
            draggingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromClientX(event.clientX);
          }}
          onPointerMove={(event) => {
            if (draggingRef.current) {
              seekFromClientX(event.clientX);
            }
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              seek(displayTime - 15 * 60 * 1000);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              seek(displayTime + 15 * 60 * 1000);
            }
          }}
        >
          <div className="timeline-chapters" aria-hidden="true">
            {chapters.map((chapter) => {
              const chapterStart = (Date.parse(chapter.startTime) - start) / span;
              const chapterSpan = (Date.parse(chapter.endTime) - Date.parse(chapter.startTime)) / span;
              return (
                <span
                  key={chapter.id}
                  className="timeline-chapter-segment"
                  style={{ left: `${chapterStart * 100}%`, width: `${chapterSpan * 100}%` }}
                  title={chapter.title}
                />
              );
            })}
          </div>
          <div className="timeline-fill" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
          <div className="timeline-cursor" style={{ left: `${progress * 100}%` }} aria-hidden="true" />
          {orderedEvents.map((event) => {
            const offset = ((Date.parse(event.time) - start) / span) * 100;
            return (
              <button
                key={event.id}
                type="button"
                className={`timeline-pip ${event.confidence}`}
                style={{ left: `${offset}%` }}
                aria-label={`Jump to ${event.title} at ${formatBattleClock(Date.parse(event.time))}`}
                title={`${formatBattleClock(Date.parse(event.time))} — ${event.title}`}
                onClick={(clickEvent) => {
                  clickEvent.stopPropagation();
                  seek(Date.parse(event.time));
                }}
                onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
                onMouseEnter={() => setHoveredEventId(event.id)}
                onMouseLeave={() => setHoveredEventId(null)}
              />
            );
          })}
        </div>

        <div className="dock-transport">
          <button
            type="button"
            className="play-button"
            data-testid="play-pause-button"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={togglePlayback}
          >
            {isPlaying ? (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="5" y="4" width="3.4" height="12" rx="0.8" fill="currentColor" />
                <rect x="11.6" y="4" width="3.4" height="12" rx="0.8" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6.5 4.2v11.6L16 10 6.5 4.2Z" fill="currentColor" />
              </svg>
            )}
          </button>
          <div className="speed-cluster" role="group" aria-label="Playback speed">
            {([1, 2, 4] as PlaybackSpeed[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={speed === candidate ? "active" : ""}
                onClick={() => setSpeed(candidate)}
              >
                {candidate}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="dock-casualties" data-testid="dock-casualties">
        <span className="dock-label">
          Casualties {casualtyState.confidence === "inferred" ? "(est.)" : ""}
        </span>
        <strong className={casualtyState.value > 0 ? "climbing" : ""}>
          {casualtyState.value.toLocaleString()}
        </strong>
        <div className="casualty-split" aria-hidden="true">
          <span className="split-union" title="Union share (estimated)">
            {Math.round((sideTotals.union / sideTotals.total) * casualtyState.value).toLocaleString()} US
          </span>
          <span className="split-confederate" title="Confederate share (estimated)">
            {Math.round((sideTotals.confederate / sideTotals.total) * casualtyState.value).toLocaleString()} CS
          </span>
        </div>
      </div>
    </div>
  );
}
