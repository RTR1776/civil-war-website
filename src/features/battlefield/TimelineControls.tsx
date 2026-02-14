"use client";

import { useMemo, useState } from "react";

import type { PlaybackSpeed } from "@/lib/battle/store";
import type { TimelineEvent } from "@/lib/battle/types";

interface TimelineControlsProps {
  selectedTime: number;
  startTime: number;
  endTime: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  timelineEvents: TimelineEvent[];
  onTogglePlay: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onTimeChange: (time: number) => void;
  onEventHover: (eventId: string | null) => void;
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export default function TimelineControls({
  selectedTime,
  startTime,
  endTime,
  isPlaying,
  speed,
  timelineEvents,
  onTogglePlay,
  onSpeedChange,
  onTimeChange,
  onEventHover,
}: TimelineControlsProps) {
  const [hoveredPreview, setHoveredPreview] = useState<TimelineEvent | null>(null);

  const orderedEvents = useMemo(
    () => [...timelineEvents].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
    [timelineEvents],
  );

  const handleHover = (ratio: number) => {
    const hoveredTime = startTime + (endTime - startTime) * ratio;

    let nearest: TimelineEvent | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const event of orderedEvents) {
      const distance = Math.abs(Date.parse(event.time) - hoveredTime);
      if (distance < nearestDistance) {
        nearest = event;
        nearestDistance = distance;
      }
    }

    if (nearest && nearestDistance <= 35 * 60 * 1000) {
      setHoveredPreview(nearest);
      onEventHover(nearest.id);
    } else {
      setHoveredPreview(null);
      onEventHover(null);
    }
  };

  return (
    <section className="timeline-card" aria-label="Battle timeline controls">
      <div className="timeline-header">
        <h2>Timeline Replay</h2>
        <p>
          {formatClock(selectedTime)} / {formatClock(endTime)}
        </p>
      </div>

      <div className="timeline-main">
        <input
          data-testid="timeline-slider"
          type="range"
          min={startTime}
          max={endTime}
          value={selectedTime}
          step={60 * 1000}
          onChange={(event) => onTimeChange(Number(event.target.value))}
          onMouseMove={(event) => {
            const input = event.currentTarget;
            const ratio =
              (event.clientX - input.getBoundingClientRect().left) / input.getBoundingClientRect().width;
            handleHover(Math.min(1, Math.max(0, ratio)));
          }}
          onMouseLeave={() => {
            setHoveredPreview(null);
            onEventHover(null);
          }}
          aria-label="Timeline scrubber"
        />
        <div className="timeline-events-row">
          {orderedEvents.map((event) => {
            const offset =
              ((Date.parse(event.time) - startTime) / Math.max(1, endTime - startTime)) * 100;
            return (
              <button
                key={event.id}
                type="button"
                className={`timeline-marker ${event.confidence}`}
                style={{ left: `${offset}%` }}
                onClick={() => onTimeChange(Date.parse(event.time))}
                onMouseEnter={() => {
                  setHoveredPreview(event);
                  onEventHover(event.id);
                }}
                onMouseLeave={() => {
                  setHoveredPreview(null);
                  onEventHover(null);
                }}
                aria-label={`Jump to ${event.title}`}
              />
            );
          })}
        </div>
      </div>

      <div className="timeline-actions">
        <button type="button" onClick={onTogglePlay} data-testid="play-pause-button">
          {isPlaying ? "Pause" : "Play"}
        </button>
        <div className="speed-cluster">
          {[1, 2, 4].map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={speed === candidate ? "active" : ""}
              onClick={() => onSpeedChange(candidate as PlaybackSpeed)}
            >
              {candidate}x
            </button>
          ))}
        </div>
      </div>

      {hoveredPreview ? (
        <div className={`event-preview ${hoveredPreview.confidence}`} data-testid="timeline-event-preview">
          <p>{formatClock(Date.parse(hoveredPreview.time))}</p>
          <h3>{hoveredPreview.title}</h3>
          <p>{hoveredPreview.detail}</p>
        </div>
      ) : null}
    </section>
  );
}
