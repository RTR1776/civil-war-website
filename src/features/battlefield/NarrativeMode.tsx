"use client";

import type { NarrativeBeat } from "@/lib/battle/types";

interface NarrativeModeProps {
  beats: NarrativeBeat[];
  guidedMode: boolean;
  activeBeatId: string | null;
  onToggleGuidedMode: (value: boolean) => void;
  onSelectBeat: (beat: NarrativeBeat) => void;
}

function formatClock(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export default function NarrativeMode({
  beats,
  guidedMode,
  activeBeatId,
  onToggleGuidedMode,
  onSelectBeat,
}: NarrativeModeProps) {
  const orderedBeats = [...beats].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

  return (
    <section className="narrative-card" aria-label="Guided narrative mode">
      <div className="narrative-header">
        <h2>Guided Key Moments</h2>
        <button
          type="button"
          data-testid="guided-mode-toggle"
          onClick={() => onToggleGuidedMode(!guidedMode)}
        >
          {guidedMode ? "Exit Guided" : "Enter Guided"}
        </button>
      </div>

      <div className="narrative-list" role="list">
        {orderedBeats.map((beat) => (
          <button
            key={beat.id}
            type="button"
            className={`narrative-item ${activeBeatId === beat.id ? "active" : ""}`}
            onClick={() => onSelectBeat(beat)}
            data-testid={`narrative-beat-${beat.id}`}
          >
            <span>{formatClock(beat.time)}</span>
            <strong>{beat.title}</strong>
            <small>{beat.description}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
