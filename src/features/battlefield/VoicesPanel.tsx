"use client";

import { useMemo, useState } from "react";

import { useBattleStore } from "@/lib/battle/store";
import { formatBattleClock } from "@/lib/battle/time";
import type { ScenarioDataBundle, Side } from "@/lib/battle/types";

interface VoicesPanelProps {
  bundle: ScenarioDataBundle;
  onClose: () => void;
}

type SideFilter = Side | "all";

export default function VoicesPanel({ bundle, onClose }: VoicesPanelProps) {
  const [filter, setFilter] = useState<SideFilter>("all");

  const activeVoiceId = useBattleStore((state) => state.storyState.activeVoiceId);
  const voicesEnabled = useBattleStore((state) => state.uiState.voicesEnabled);
  const setVoicesEnabled = useBattleStore((state) => state.setVoicesEnabled);
  const cueVoice = useBattleStore((state) => state.cueVoice);

  const sourcesById = useMemo(
    () => new Map(bundle.evidenceSources.map((source) => [source.id, source])),
    [bundle.evidenceSources],
  );

  const shown = useMemo(
    () => bundle.voices.filter((voice) => filter === "all" || voice.side === filter),
    [bundle.voices, filter],
  );

  return (
    <aside className="voices-panel" data-testid="voices-panel" aria-label="First-person accounts">
      <header className="records-header">
        <h2>Voices of Franklin</h2>
        <button type="button" className="intel-close" aria-label="Close accounts" onClick={onClose}>
          ×
        </button>
      </header>

      <p className="records-method">
        Every line below is a verbatim quotation from someone who was there, or from the regimental
        record of a unit that was. Nothing is paraphrased and nothing is invented; each carries its
        citation. They surface on the map as the clock reaches them.
      </p>

      <div className="voices-controls">
        <div className="voices-filter" role="group" aria-label="Filter accounts by side">
          {(["all", "Confederate", "Union"] as SideFilter[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={filter === candidate ? "active" : ""}
              onClick={() => setFilter(candidate)}
            >
              {candidate === "all" ? "Both" : candidate}
            </button>
          ))}
        </div>

        <label className="voices-toggle">
          <input
            type="checkbox"
            checked={voicesEnabled}
            onChange={(event) => setVoicesEnabled(event.target.checked)}
          />
          <span>Surface during playback</span>
        </label>
      </div>

      <ol className="voices-list">
        {shown.map((voice) => {
          const source = sourcesById.get(voice.sourceId);
          return (
            <li
              key={voice.id}
              className={`${voice.id === activeVoiceId ? "active " : ""}side-${voice.side.toLowerCase()}`}
            >
              <button
                type="button"
                className="voice-entry"
                data-testid={`voice-${voice.id}`}
                onClick={() => cueVoice(voice)}
              >
                <span className="voice-entry-time">
                  {voice.time ? formatBattleClock(Date.parse(voice.time)) : "—"}
                </span>
                <span className="voice-entry-body">
                  <strong>{voice.speaker}</strong>
                  <small>{voice.role}</small>
                  <q>{voice.quote}</q>
                  {voice.place ? <em className="voice-entry-place">{voice.place}</em> : null}
                  {source ? (
                    <span className="voice-entry-source">
                      {source.author}, {source.title} ({source.year})
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
